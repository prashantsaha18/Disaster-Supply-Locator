import os
import re
import json
import requests
import psycopg2
import psycopg2.extras
import math
import time
from flask import Flask, request, jsonify
from flask_cors import CORS
import firebase_admin

from firebase_admin import credentials, auth

# ── Fast2SMS Configuration ─────────────────────────────────────────────────
FAST2SMS_API_KEY = os.environ.get("FAST2SMS_API_KEY", "").strip()
if not FAST2SMS_API_KEY:
    _f2s_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fast2sms_api_key.txt")
    if os.path.exists(_f2s_file):
        with open(_f2s_file, encoding="utf-8-sig") as f:
            FAST2SMS_API_KEY = f.read().strip()

FAST2SMS_URL = "https://www.fast2sms.com/dev/bulkV2"


def clean_phone(phone):
    """
    Extract a 10-digit Indian mobile number from any format.
      9960831634    →  9960831634
      +919960831634 →  9960831634
      09960831634   →  9960831634
    """
    digits = re.sub(r'\D', '', phone)
    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    if digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    if len(digits) != 10:
        raise ValueError(f"Expected 10 digits, got {len(digits)} from '{phone}'")
    return digits


def strip_ansi(text):
    return re.sub(r'\x1b\[[0-9;]*m', '', str(text))


try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import sys
app = Flask(__name__)
CORS(app)


# ── Shared SMS sender (used by both single and bulk routes) ────────────────
def _send_via_fast2sms(mobile, message):
    """
    Send a single SMS. Returns (success: bool, error_str: str).
    """
    if not FAST2SMS_API_KEY:
        return False, "Fast2SMS API key not configured"
    payload = {"route": "q", "numbers": mobile, "message": message, "flash": 0}
    headers = {"authorization": FAST2SMS_API_KEY, "Content-Type": "application/json"}
    resp   = requests.post(FAST2SMS_URL, json=payload, headers=headers, timeout=10)
    result = resp.json()
    if result.get("return") is True:
        return True, ""
    msgs     = result.get("message", [])
    friendly = " | ".join(msgs) if isinstance(msgs, list) else str(msgs)
    return False, friendly


# ── Geocoding helpers ──────────────────────────────────────────────────────
# ── Geocoding Helpers (with Caching & Fallback) ─────────────────────────────
GEO_CACHE = {
    "nagpur": (21.1458, 79.0882),
    "nagpur, maharashtra": (21.1458, 79.0882),
    "chandrapur": (19.9510, 79.2961),
    "chandrapur, maharashtra": (19.9510, 79.2961),
    "chandrapur, india": (19.9510, 79.2961)
}

def get_coords(address):
    """
    Geocode using Nominatim, Geocode.maps.co, and Photon (Komoot).
    Includes a local cache and hardcoded defaults for critical test cities.
    """
    # ── FIX: guard against None / empty address ───────────────────────────
    if not address or not str(address).strip():
        return None
    clean_addr = str(address).strip().lower()
    if clean_addr in GEO_CACHE:
        print(f"[GEOCODE] Cache HIT for '{address}'", flush=True)
        return GEO_CACHE[clean_addr]

    # Providers to try
    providers = [
        ("Nominatim", "https://nominatim.openstreetmap.org/search", {"q": address, "format": "json", "limit": 1}),
        ("Geocode.maps.co", "https://geocode.maps.co/search", {"q": address}),
        ("Photon", "https://photon.komoot.io/api/", {"q": address, "limit": 1})
    ]

    hdrs = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"}

    for name, url, params in providers:
        try:
            print(f"[GEOCODE] Trying {name} for '{address}'...", flush=True)
            resp = requests.get(url, params=params, headers=hdrs, timeout=10)
            
            if resp.status_code == 200:
                data = resp.json()
                # Handle different response formats (Photon is different)
                if name == "Photon":
                    if data.get("features"):
                        geom = data["features"][0].get("geometry", {}).get("coordinates", [])
                        if len(geom) == 2:
                            coords = (float(geom[1]), float(geom[0])) # Photon returns [lon, lat]
                            GEO_CACHE[clean_addr] = coords
                            return coords
                else:
                    if data and isinstance(data, list) and len(data) > 0:
                        coords = (float(data[0]["lat"]), float(data[0]["lon"]))
                        GEO_CACHE[clean_addr] = coords
                        return coords
            else:
                print(f"[GEOCODE] {name} returned status {resp.status_code}", flush=True)
            
            time.sleep(1.1)
        except Exception as e:
            print(f"[GEOCODE] {name} error for '{address}': {e}", flush=True)

    return None


def calculate_distance(lat1, lon1, lat2, lon2):
    """Haversine formula — returns distance in km."""
    R    = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a    = (math.sin(dlat / 2) ** 2
            + math.cos(math.radians(lat1))
            * math.cos(math.radians(lat2))
            * math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


@app.route("/api/geocode", methods=["GET"])
def geocode_api():
    """Expose the cached geocoding helper to the frontend."""
    address = request.args.get("q")
    if not address:
        return err("Address 'q' is required")
    coords = get_coords(address)
    if not coords:
        return err(f"Could not find coordinates for '{address}'", 404)
    return ok({"lat": coords[0], "lon": coords[1]})


# ── Single SMS ────────────────────────────────────────────────────────────
@app.route("/api/send-sms", methods=["POST"])
def send_sms():
    data    = request.get_json(silent=True) or {}
    phone   = (data.get("phone") or "").strip()
    message = (data.get("message") or "").strip()

    if not phone or not message:
        return err("phone and message are required")
    if not FAST2SMS_API_KEY:
        return err("Fast2SMS API key not configured.", 500)

    try:
        mobile = clean_phone(phone)
    except ValueError as e:
        return err(f"Invalid phone number: {e}")

    success, error_msg = _send_via_fast2sms(mobile, message)
    if success:
        return ok(message=f"SMS sent successfully to {mobile}")
    return err(f"SMS failed: {error_msg}", 500)


# ── Bulk SMS (sends to all users within radius of a relief center) ─────────
@app.route("/api/send-sms-bulk", methods=["POST"])
def send_sms_bulk():
    # ── TOP-LEVEL try/except: always return JSON, never crash to HTML ─────
    try:
        return _send_sms_bulk_impl()
    except Exception as exc:
        import traceback
        traceback.print_exc()
        return err(f"Unexpected server error: {exc}", 500)


def _send_sms_bulk_impl():
    data           = request.get_json(silent=True) or {}
    center_address = (data.get("center_address") or "").strip()
    message        = (data.get("message") or "").strip()
    radius_km      = float(data.get("radius_km", 50))

    if not center_address or not message:
        return err("center_address and message are required")
    if not FAST2SMS_API_KEY:
        return err("Fast2SMS API key not configured. Add it to fast2sms_api_key.txt", 500)

    # ── 1. Geocode the relief center ──────────────────────────────────────
    print(f"[BULK] Geocoding center: {center_address}", flush=True)
    center_coords = get_coords(center_address)
    time.sleep(1)   # ← mandatory Nominatim rate-limit pause

    if not center_coords:
        return err(
            f"Could not find coordinates for '{center_address}'. "
            "Try a more specific address (include city and state).", 400
        )
    print(f"[BULK] Center coords: {center_coords}", flush=True)

    # ── 2. Load all registered users ─────────────────────────────────────
    try:
        conn = get_db()
        cur  = conn.cursor()
        cur.execute("SELECT user_name, phone, address FROM users")
        users = cur.fetchall()
        cur.close()
        conn.close()
    except Exception as e:
        return err(f"Database error while fetching users: {e}", 500)

    if not users:
        return ok({"sent": 0, "skipped": 0, "failed": 0,
                   "details_sent": [], "details_failed": []},
                  "No registered users found.")

    results = {
        "sent":           0,
        "skipped":        0,
        "failed":         0,
        "details_sent":   [],
        "details_failed": [],
    }

    # ── 3. Geocode each user — with 1-second delay between every call ─────
    for i, user in enumerate(users):
        uname  = user["user_name"]
        uphone = user["phone"]
        uaddr  = user["address"]

        # ── FIX: skip users with null/empty address ───────────────────────
        if not uaddr or not str(uaddr).strip():
            print(f"[BULK] ({i+1}/{len(users)}) '{uname}' has no address — skipping", flush=True)
            results["skipped"] += 1
            results["details_failed"].append({
                "name":   uname,
                "phone":  uphone or "—",
                "reason": "No address on file",
            })
            continue

        print(f"[BULK] ({i+1}/{len(users)}) Geocoding '{uname}' at: {uaddr}", flush=True)

        u_coords = get_coords(uaddr)
        time.sleep(1)   # ← pause after every Nominatim call

        if not u_coords:
            print(f"[BULK]   Geocode FAILED — skipping", flush=True)
            results["skipped"] += 1
            results["details_failed"].append({
                "name":   uname,
                "phone":  uphone or "—",
                "reason": f"Could not geocode address: {uaddr}",
            })
            continue

        dist = calculate_distance(
            center_coords[0], center_coords[1],
            u_coords[0],      u_coords[1]
        )
        print(f"[BULK]   Distance: {round(dist,1)} km (limit: {radius_km} km)", flush=True)

        if dist > radius_km:
            print(f"[BULK]   Too far — skipping", flush=True)
            results["skipped"] += 1
            continue

        # Within radius — validate phone then send
        try:
            mobile = clean_phone(uphone)
        except ValueError as e:
            print(f"[BULK]   Bad phone '{uphone}': {e}", flush=True)
            results["failed"] += 1
            results["details_failed"].append({
                "name":   uname,
                "phone":  uphone,
                "reason": f"Invalid phone number: {e}",
            })
            continue

        print(f"[BULK]   Sending to {mobile}…", flush=True)
        success, error_msg = _send_via_fast2sms(mobile, message)

        if success:
            print(f"[BULK]   Sent OK", flush=True)
            results["sent"] += 1
            results["details_sent"].append({
                "name":        uname,
                "phone":       uphone,
                "distance_km": round(dist, 1),
            })
        else:
            print(f"[BULK]   FAILED: {error_msg}", flush=True)
            results["failed"] += 1
            results["details_failed"].append({
                "name":   uname,
                "phone":  uphone,
                "reason": error_msg,
            })

    print(f"[BULK] Done — sent:{results['sent']} "
          f"skipped:{results['skipped']} failed:{results['failed']}", flush=True)
    return ok(results, "Bulk SMS processing complete")


@app.before_request
def log_request():
    print(f"\n>>> {request.method} {request.path}", flush=True)
    sys.stdout.flush()

# ── Firebase Initialization ────────────────────────────────────────────────
SERVICE_ACCOUNT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "serviceAccountKey.json")
cred = None

if os.path.exists(SERVICE_ACCOUNT_FILE):
    with open(SERVICE_ACCOUNT_FILE, encoding="utf-8-sig") as f:
        sa_info = json.load(f)
    cred = credentials.Certificate(sa_info)
else:
    _sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
    if _sa_json:
        cred = credentials.Certificate(json.loads(_sa_json))

if cred:
    try:
        firebase_admin.initialize_app(cred)
    except Exception as e:
        print(f"Firebase Init Warning: {e}")
else:
    print("Warning: Firebase credentials not found. Authentication will fail.")

FIREBASE_WEB_API_KEY = os.environ.get("FIREBASE_WEB_API_KEY", "").strip()
if not FIREBASE_WEB_API_KEY:
    _key_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web_api_key.txt")
    if os.path.exists(_key_file):
        with open(_key_file, encoding="utf-8-sig") as f:
            FIREBASE_WEB_API_KEY = f.read().strip()

if not FIREBASE_WEB_API_KEY:
    print("Warning: FIREBASE_WEB_API_KEY not found.")

FIREBASE_AUTH_URL = "https://identitytoolkit.googleapis.com/v1/accounts"

# ── PostgreSQL Connection ──────────────────────────────────────────────────
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
if not DATABASE_URL:
    _db_url_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "database_url.txt")
    if os.path.exists(_db_url_file):
        with open(_db_url_file, encoding="utf-8-sig") as f:
            DATABASE_URL = f.read().strip()

if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL not found. Add it to .env or create database_url.txt")


def get_db():
    return psycopg2.connect(
        DATABASE_URL,
        cursor_factory=psycopg2.extras.RealDictCursor,
        connect_timeout=10
    )


def init_db():
    import time as _time
    last_err = None
    for attempt in range(1, 6):
        try:
            conn = get_db()
            break
        except Exception as e:
            last_err = e
            print(f"[DB] Attempt {attempt}/5 failed: {e}. Retrying in 3s…")
            _time.sleep(3)
    else:
        raise RuntimeError(f"DB unreachable after 5 attempts. Last: {last_err}")

    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS admins (
            uid          TEXT PRIMARY KEY,
            email        TEXT UNIQUE NOT NULL,
            company_name TEXT NOT NULL,
            phone        TEXT NOT NULL,
            created_at   TIMESTAMP DEFAULT NOW()
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            uid        TEXT PRIMARY KEY,
            email      TEXT UNIQUE NOT NULL,
            user_name  TEXT NOT NULL,
            phone      TEXT NOT NULL,
            address    TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS relief_centers (
            id           SERIAL PRIMARY KEY,
            center_name  TEXT NOT NULL,
            relief_type  TEXT NOT NULL,
            address      TEXT NOT NULL,
            phone_number TEXT NOT NULL,
            admin_uid    TEXT NOT NULL,
            last_updated TIMESTAMP DEFAULT NOW(),
            created_at   TIMESTAMP DEFAULT NOW()
        )
    """)
    conn.commit()
    cur.close()
    conn.close()


init_db()


# ── Helpers ───────────────────────────────────────────────────────────────
def firebase_rest(endpoint, payload):
    url  = f"{FIREBASE_AUTH_URL}:{endpoint}?key={FIREBASE_WEB_API_KEY}"
    resp = requests.post(url, json=payload, timeout=10)
    return resp.json(), resp.status_code


def ok(data=None, message="success", status=200):
    body = {"success": True, "message": message}
    if data is not None:
        body["data"] = data
    return jsonify(body), status


def err(message, status=400):
    return jsonify({"success": False, "message": message}), status


def verify_admin_token():
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None, err("Authorization header missing or malformed", 401)
    id_token = auth_header.split("Bearer ")[1].strip()
    try:
        decoded = auth.verify_id_token(id_token)
    except Exception as e:
        return None, err(f"Invalid or expired token: {str(e)}", 401)
    uid  = decoded["uid"]
    conn = get_db()
    cur  = conn.cursor()
    cur.execute("SELECT uid FROM admins WHERE uid = %s", (uid,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    if not row:
        return None, err("Access denied: not an admin", 403)
    return uid, None


# ════════════════════════════════════════════════════════════════════════════
#  ADMIN AUTH
# ════════════════════════════════════════════════════════════════════════════
@app.route("/api/admin/register", methods=["POST"])
def admin_register():
    data         = request.get_json(silent=True) or {}
    email        = (data.get("email") or "").strip().lower()
    password     = data.get("password", "").strip()
    company_name = (data.get("companyName") or "").strip()
    phone        = (data.get("phone") or "").strip()

    if not email or not password or not company_name or not phone:
        return err("email, password, companyName, and phone are required")
    if len(password) < 6:
        return err("Password must be at least 6 characters")

    try:
        user = auth.create_user(email=email, password=password)
    except auth.EmailAlreadyExistsError:
        return err("An account with this email already exists. Please sign in.", 409)
    except Exception as e:
        return err(str(e), 500)

    try:
        conn = get_db()
        cur  = conn.cursor()
        cur.execute(
            "INSERT INTO admins (uid, email, company_name, phone) VALUES (%s, %s, %s, %s)",
            (user.uid, email, company_name, phone)
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        return err(f"Database error: {str(e)}", 500)

    payload, _ = firebase_rest("signInWithPassword", {
        "email": email, "password": password, "returnSecureToken": True,
    })
    if "idToken" not in payload:
        return err(payload.get("error", {}).get("message", "Sign-in failed after registration"), 500)

    return ok({
        "uid": user.uid, "email": email,
        "companyName": company_name, "phone": phone,
        "idToken": payload["idToken"],
        "refreshToken": payload.get("refreshToken"),
    }, "Admin registered successfully", 201)


@app.route("/api/admin/signin", methods=["POST"])
def admin_signin():
    data     = request.get_json(silent=True) or {}
    email    = (data.get("email") or "").strip().lower()
    password = data.get("password", "").strip()

    if not email or not password:
        return err("email and password are required")

    payload, _ = firebase_rest("signInWithPassword", {
        "email": email, "password": password, "returnSecureToken": True,
    })

    if "idToken" not in payload:
        msg = payload.get("error", {}).get("message", "Invalid credentials")
        if msg in ("EMAIL_NOT_FOUND", "INVALID_EMAIL"):
            return err("No account found with this email. Please register first.", 404)
        if msg in ("INVALID_PASSWORD", "INVALID_LOGIN_CREDENTIALS"):
            return err("Incorrect password. Please try again.", 401)
        return err(msg, 401)

    uid  = payload["localId"]
    conn = get_db()
    cur  = conn.cursor()
    cur.execute("SELECT uid, email, company_name, phone FROM admins WHERE uid = %s", (uid,))
    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row:
        return err("This account is not registered as an admin.", 403)

    return ok({
        "uid": uid, "email": email,
        "companyName": row["company_name"], "phone": row["phone"],
        "idToken": payload["idToken"],
        "refreshToken": payload.get("refreshToken"),
    }, "Admin signed in successfully")


@app.route("/api/admin/reset-password", methods=["POST"])
def admin_reset_password():
    data         = request.get_json(silent=True) or {}
    email        = (data.get("email") or "").strip().lower()
    new_password = data.get("newPassword", "").strip()

    if not email or not new_password:
        return err("email and newPassword are required")
    if len(new_password) < 6:
        return err("Password must be at least 6 characters")

    try:
        user = auth.get_user_by_email(email)
    except auth.UserNotFoundError:
        return err("No account found with this email.", 404)
    except Exception as e:
        return err(str(e), 500)

    conn = get_db()
    cur  = conn.cursor()
    cur.execute("SELECT uid FROM admins WHERE uid = %s", (user.uid,))
    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row:
        return err("This account is not registered as an admin.", 403)

    try:
        auth.update_user(user.uid, password=new_password)
    except Exception as e:
        return err(str(e), 500)

    return ok(message="Password reset successfully. You can now sign in.")


# ════════════════════════════════════════════════════════════════════════════
#  USER AUTH
# ════════════════════════════════════════════════════════════════════════════
@app.route("/api/user/register", methods=["POST"])
def user_register():
    data      = request.get_json(silent=True) or {}
    email     = (data.get("email") or "").strip().lower()
    user_name = (data.get("userName") or "").strip()
    phone     = (data.get("phone") or "").strip()
    address   = (data.get("address") or "").strip()

    if not email or not user_name or not phone or not address:
        return err("email, userName, phone, and address are required")

    import secrets
    auto_password = secrets.token_urlsafe(16)

    try:
        user = auth.create_user(email=email, password=auto_password, display_name=user_name)
    except auth.EmailAlreadyExistsError:
        return err("An account with this email already exists. Please sign in.", 409)
    except Exception as e:
        return err(str(e), 500)

    try:
        conn = get_db()
        cur  = conn.cursor()
        cur.execute(
            "INSERT INTO users (uid, email, user_name, phone, address) VALUES (%s, %s, %s, %s, %s)",
            (user.uid, email, user_name, phone, address)
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        return err(f"Database error: {str(e)}", 500)

    try:
        custom_token = auth.create_custom_token(user.uid)
    except Exception as e:
        return err(str(e), 500)

    return ok({
        "uid": user.uid, "email": email,
        "userName": user_name, "phone": phone,
        "customToken": custom_token.decode() if isinstance(custom_token, bytes) else custom_token,
    }, "User registered successfully", 201)


@app.route("/api/user/signin", methods=["POST"])
def user_signin():
    data  = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()

    if not email:
        return err("email is required")

    try:
        user = auth.get_user_by_email(email)
    except auth.UserNotFoundError:
        return err("No account found with this email. Please register first.", 404)
    except Exception as e:
        return err(str(e), 500)

    conn = get_db()
    cur  = conn.cursor()
    cur.execute("SELECT uid, email, user_name, phone FROM users WHERE uid = %s", (user.uid,))
    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row:
        return err("No user account found with this email. Please register first.", 404)

    try:
        custom_token = auth.create_custom_token(user.uid)
    except Exception as e:
        return err(str(e), 500)

    return ok({
        "uid": user.uid, "email": email,
        "userName": row["user_name"], "phone": row["phone"],
        "customToken": custom_token.decode() if isinstance(custom_token, bytes) else custom_token,
    }, "User signed in successfully")


# ════════════════════════════════════════════════════════════════════════════
#  RELIEF CENTERS
# ════════════════════════════════════════════════════════════════════════════
@app.route("/api/relief-centers", methods=["GET"])
def list_relief_centers():
    conn = get_db()
    cur  = conn.cursor()
    cur.execute("""
        SELECT id, center_name, relief_type, address, phone_number,
               admin_uid, last_updated, created_at
        FROM relief_centers ORDER BY created_at DESC
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return ok([{
        "id":          r["id"],
        "centerName":  r["center_name"],
        "reliefType":  r["relief_type"],
        "address":     r["address"],
        "phoneNumber": r["phone_number"],
        "adminUid":    r["admin_uid"],
        "lastUpdated": r["last_updated"].isoformat() if r["last_updated"] else None,
        "createdAt":   r["created_at"].isoformat()   if r["created_at"]   else None,
    } for r in rows])


@app.route("/api/relief-centers", methods=["POST"])
def add_relief_center():
    uid, error_resp = verify_admin_token()
    if error_resp:
        return error_resp

    data         = request.get_json(silent=True) or {}
    center_name  = (data.get("centerName")  or "").strip()
    relief_type  = (data.get("reliefType")  or "").strip()
    address      = (data.get("address")     or "").strip()
    phone_number = (data.get("phoneNumber") or "").strip()

    if not center_name or not relief_type or not address or not phone_number:
        return err("centerName, reliefType, address, and phoneNumber are required")

    conn = get_db()
    cur  = conn.cursor()
    cur.execute("""
        INSERT INTO relief_centers (center_name, relief_type, address, phone_number, admin_uid)
        VALUES (%s, %s, %s, %s, %s) RETURNING id, last_updated
    """, (center_name, relief_type, address, phone_number, uid))
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()

    return ok({
        "id":          row["id"],
        "centerName":  center_name, "reliefType": relief_type,
        "address":     address,     "phoneNumber": phone_number,
        "lastUpdated": row["last_updated"].isoformat() if row["last_updated"] else None,
    }, "Relief center added successfully", 201)


@app.route("/api/relief-centers/<int:center_id>", methods=["PUT"])
def update_relief_center(center_id):
    uid, error_resp = verify_admin_token()
    if error_resp:
        return error_resp

    data    = request.get_json(silent=True) or {}
    fields  = []
    values  = []
    mapping = {
        "centerName": "center_name", "reliefType": "relief_type",
        "address":    "address",     "phoneNumber": "phone_number",
    }
    for json_key, db_col in mapping.items():
        if json_key in data:
            fields.append(f"{db_col} = %s")
            values.append(data[json_key].strip())

    if not fields:
        return err("No fields provided to update")

    fields.append("last_updated = NOW()")
    values.append(center_id)

    conn = get_db()
    cur  = conn.cursor()
    cur.execute(f"UPDATE relief_centers SET {', '.join(fields)} WHERE id = %s RETURNING id", values)
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()

    if not row:
        return err("Relief center not found", 404)

    return ok({"id": center_id, **{k: data[k] for k in mapping if k in data}},
              "Relief center updated successfully")


@app.route("/api/relief-centers/<int:center_id>", methods=["DELETE"])
def delete_relief_center(center_id):
    uid, error_resp = verify_admin_token()
    if error_resp:
        return error_resp

    conn = get_db()
    cur  = conn.cursor()
    cur.execute("DELETE FROM relief_centers WHERE id = %s RETURNING id", (center_id,))
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()

    if not row:
        return err("Relief center not found", 404)

    return ok(message="Relief center deleted successfully")


# ════════════════════════════════════════════════════════════════════════════
#  HEALTH CHECK
# ════════════════════════════════════════════════════════════════════════════
@app.route("/api/healthz", methods=["GET"])
def health():
    try:
        conn = get_db()
        cur  = conn.cursor()
        cur.execute("SELECT 1")
        cur.close()
        conn.close()
        db_status = "connected"
    except Exception as e:
        db_status = f"error: {str(e)}"
    return ok({"firebase_auth": "connected", "database": db_status}, "healthy")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    # use_debugger=False prevents Flask from returning HTML error pages
    # instead of JSON — which caused the frontend 'network error' symptom.
    app.run(host="0.0.0.0", port=port, debug=True,
            use_reloader=False, use_debugger=False)