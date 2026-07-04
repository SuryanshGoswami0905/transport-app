"""
Transport Broker Management System - Backend API
Flask + MySQL + Cloudinary

Flow for booking creation (as requested):
  1. Frontend sends form-data (fields + optional goods photo) to Flask.
  2. Flask VALIDATES the fields first.
  3. If an image was attached, Flask uploads it to Cloudinary and gets back a URL.
  4. Flask inserts the booking row (with the Cloudinary URL) into MySQL.
  5. Flask sends an acknowledgement (success/failure + saved record) back to the frontend.
"""

import os
import traceback
import decimal
from datetime import date, datetime, timedelta

import cloudinary
import cloudinary.uploader
import mysql.connector
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from mysql.connector import pooling
from werkzeug.utils import secure_filename

load_dotenv()

# ---------------------------------------------------------------------------
# Config (reads from environment variables — see .env.example)
# ---------------------------------------------------------------------------
app = Flask(__name__)
CORS(app)  # allow the plain HTML/JS frontend (served separately) to call this API

DB_CONFIG = {
    "host": os.environ.get("MYSQLHOST", os.environ.get("DB_HOST", "localhost")),
    "user": os.environ.get("MYSQLUSER", os.environ.get("DB_USER", "root")),
    "password": os.environ.get("MYSQLPASSWORD", os.environ.get("DB_PASSWORD", "")),
    "database": os.environ.get("MYSQLDATABASE", os.environ.get("DB_NAME", "transport_broker")),
    "port": int(os.environ.get("MYSQLPORT", os.environ.get("DB_PORT", 3306))),
}

APP_PIN = os.environ.get("APP_PIN", "1234")  # PIN login, same idea as original React app

cloudinary.config(
    cloud_name=os.environ.get("CLOUDINARY_CLOUD_NAME"),
    api_key=os.environ.get("CLOUDINARY_API_KEY"),
    api_secret=os.environ.get("CLOUDINARY_API_SECRET"),
    secure=True,
)

cnx_pool = pooling.MySQLConnectionPool(pool_name="tp_pool", pool_size=5, **DB_CONFIG)

STATUSES = ["Pending", "Driver Assigned", "Goods Loaded", "In Transit", "Delivered", "Payment Received"]
ALLOWED_IMAGE_EXT = {"png", "jpg", "jpeg", "webp"}


def get_conn():
    return cnx_pool.get_connection()


def serialize_row(row):
    """Flask's default JSON encoder turns Python date/datetime objects into
    HTTP-date strings (e.g. 'Fri, 03 Jul 2026 00:00:00 GMT'), which breaks
    <input type="date"> on the frontend (it needs 'YYYY-MM-DD'). This converts
    date/datetime/Decimal fields into JSON-friendly values before they're sent."""
    if not row:
        return row
    out = dict(row)
    for k, v in out.items():
        if isinstance(v, datetime):
            out[k] = v.strftime("%Y-%m-%d")
        elif isinstance(v, date):
            out[k] = v.isoformat()
        elif isinstance(v, timedelta):
            out[k] = str(v)
        elif isinstance(v, decimal.Decimal):
            out[k] = float(v)
    return out


def serialize_rows(rows):
    return [serialize_row(r) for r in rows]


def allowed_image(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_IMAGE_EXT


def next_bilti_no(cursor):
    cursor.execute("SELECT COUNT(*) AS c FROM bookings")
    count = cursor.fetchone()["c"]
    year = datetime.now().year
    return f"BLT-{year}-{str(count + 1).zfill(3)}"


def compute_commission(agreed_rate, commission_type, commission_value):
    agreed_rate = float(agreed_rate or 0)
    commission_value = float(commission_value or 0)
    if commission_type == "percent":
        return round(agreed_rate * commission_value / 100)
    return commission_value


# ---------------------------------------------------------------------------
# Auth (simple PIN check, mirrors the original PinLogin screen)
# ---------------------------------------------------------------------------
@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    pin = str(data.get("pin", ""))
    if pin == APP_PIN:
        return jsonify({"success": True, "message": "Logged in"})
    return jsonify({"success": False, "message": "Incorrect PIN"}), 401


# ---------------------------------------------------------------------------
# Image upload helper endpoint (used standalone if you ever need just the URL)
# ---------------------------------------------------------------------------
@app.route("/api/upload", methods=["POST"])
def upload_image():
    if "image" not in request.files:
        return jsonify({"success": False, "message": "No image file provided"}), 400
    file = request.files["image"]
    if file.filename == "" or not allowed_image(file.filename):
        return jsonify({"success": False, "message": "Invalid or missing image file"}), 400
    try:
        result = cloudinary.uploader.upload(file, folder="transport_broker/goods")
        return jsonify({"success": True, "url": result["secure_url"], "public_id": result["public_id"]})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"success": False, "message": f"Cloudinary upload failed: {e}"}), 500


# ---------------------------------------------------------------------------
# Drivers CRUD
# ---------------------------------------------------------------------------
@app.route("/api/drivers", methods=["GET"])
def list_drivers():
    conn = get_conn()
    cur = conn.cursor(dictionary=True)
    cur.execute("SELECT * FROM drivers ORDER BY created_at DESC")
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify(serialize_rows(rows))


@app.route("/api/drivers", methods=["POST"])
def create_driver():
    d = request.get_json(silent=True) or {}
    required = ["name", "phone"]
    missing = [f for f in required if not d.get(f)]
    if missing:
        return jsonify({"success": False, "message": f"Missing fields: {', '.join(missing)}"}), 400

    conn = get_conn()
    cur = conn.cursor(dictionary=True)
    cur.execute(
        """INSERT INTO drivers (name, phone, truck_type, truck_number, bank_name, bank_account, upi, ifsc)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
        (d["name"], d["phone"], d.get("truckType"), d.get("truckNumber"),
         d.get("bank"), d.get("bankAccount"), d.get("upi"), d.get("ifsc")),
    )
    conn.commit()
    new_id = cur.lastrowid
    cur.execute("SELECT * FROM drivers WHERE id=%s", (new_id,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return jsonify({"success": True, "message": "Driver added!", "driver": serialize_row(row)}), 201


@app.route("/api/drivers/<int:driver_id>", methods=["PUT"])
def update_driver(driver_id):
    d = request.get_json(silent=True) or {}
    conn = get_conn()
    cur = conn.cursor(dictionary=True)
    cur.execute(
        """UPDATE drivers SET name=%s, phone=%s, truck_type=%s, truck_number=%s,
           bank_name=%s, bank_account=%s, upi=%s, ifsc=%s WHERE id=%s""",
        (d.get("name"), d.get("phone"), d.get("truckType"), d.get("truckNumber"),
         d.get("bank"), d.get("bankAccount"), d.get("upi"), d.get("ifsc"), driver_id),
    )
    conn.commit()
    cur.execute("SELECT * FROM drivers WHERE id=%s", (driver_id,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return jsonify({"success": True, "message": "Driver updated!", "driver": serialize_row(row)})


@app.route("/api/drivers/<int:driver_id>", methods=["DELETE"])
def delete_driver(driver_id):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM drivers WHERE id=%s", (driver_id,))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({"success": True, "message": "Driver deleted!"})


# ---------------------------------------------------------------------------
# Clients CRUD
# ---------------------------------------------------------------------------
@app.route("/api/clients", methods=["GET"])
def list_clients():
    conn = get_conn()
    cur = conn.cursor(dictionary=True)
    cur.execute("SELECT * FROM clients ORDER BY created_at DESC")
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify(serialize_rows(rows))


@app.route("/api/clients", methods=["POST"])
def create_client():
    d = request.get_json(silent=True) or {}
    required = ["name", "phone"]
    missing = [f for f in required if not d.get(f)]
    if missing:
        return jsonify({"success": False, "message": f"Missing fields: {', '.join(missing)}"}), 400

    conn = get_conn()
    cur = conn.cursor(dictionary=True)
    cur.execute(
        "INSERT INTO clients (name, company, phone, city, address) VALUES (%s,%s,%s,%s,%s)",
        (d["name"], d.get("company"), d["phone"], d.get("city"), d.get("address")),
    )
    conn.commit()
    new_id = cur.lastrowid
    cur.execute("SELECT * FROM clients WHERE id=%s", (new_id,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return jsonify({"success": True, "message": "Client added!", "client": serialize_row(row)}), 201


@app.route("/api/clients/<int:client_id>", methods=["PUT"])
def update_client(client_id):
    d = request.get_json(silent=True) or {}
    conn = get_conn()
    cur = conn.cursor(dictionary=True)
    cur.execute(
        "UPDATE clients SET name=%s, company=%s, phone=%s, city=%s, address=%s WHERE id=%s",
        (d.get("name"), d.get("company"), d.get("phone"), d.get("city"), d.get("address"), client_id),
    )
    conn.commit()
    cur.execute("SELECT * FROM clients WHERE id=%s", (client_id,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return jsonify({"success": True, "message": "Client updated!", "client": serialize_row(row)})


@app.route("/api/clients/<int:client_id>", methods=["DELETE"])
def delete_client(client_id):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM clients WHERE id=%s", (client_id,))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({"success": True, "message": "Client deleted!"})


# ---------------------------------------------------------------------------
# Bookings CRUD  (this is the form with the image -> Cloudinary -> MySQL flow)
# ---------------------------------------------------------------------------
@app.route("/api/bookings", methods=["GET"])
def list_bookings():
    conn = get_conn()
    cur = conn.cursor(dictionary=True)
    cur.execute("""
        SELECT b.*, c.name AS client_name, c.company AS client_company,
               dr.name AS driver_name, dr.phone AS driver_phone
        FROM bookings b
        LEFT JOIN clients c ON c.id = b.client_id
        LEFT JOIN drivers dr ON dr.id = b.driver_id
        ORDER BY b.created_at DESC
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify(serialize_rows(rows))


@app.route("/api/bookings", methods=["POST"])
def create_booking():
    # Step 1: read form fields (multipart/form-data because an image file may be attached)
    d = request.form
    image_file = request.files.get("goods_image")

    # Step 2: VALIDATE first, before touching Cloudinary or the DB
    required = ["client_id", "pickup_location", "drop_location", "agreed_rate", "booking_date"]
    missing = [f for f in required if not d.get(f)]
    if missing:
        return jsonify({"success": False, "message": f"Missing required fields: {', '.join(missing)}"}), 400

    try:
        agreed_rate = float(d.get("agreed_rate"))
    except ValueError:
        return jsonify({"success": False, "message": "agreed_rate must be a number"}), 400

    image_url, image_public_id = None, None
    if image_file and image_file.filename:
        if not allowed_image(image_file.filename):
            return jsonify({"success": False, "message": "Image must be png/jpg/jpeg/webp"}), 400
        # Step 3: upload to Cloudinary, get back the hosted URL
        try:
            result = cloudinary.uploader.upload(image_file, folder="transport_broker/goods")
            image_url = result["secure_url"]
            image_public_id = result["public_id"]
        except Exception as e:
            traceback.print_exc()
            return jsonify({"success": False, "message": f"Image upload failed: {e}"}), 500

    conn = get_conn()
    cur = conn.cursor(dictionary=True)
    bilti_no = next_bilti_no(cur)

    # Step 4: insert booking row (with the Cloudinary URL) into MySQL
    cur.execute(
        """INSERT INTO bookings
           (bilti_no, client_id, driver_id, pickup_location, drop_location, truck_type,
            goods_description, weight, agreed_rate, booking_date, status,
            commission_type, commission_value, goods_image_url, goods_image_public_id, notes)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (
            bilti_no,
            d.get("client_id"),
            d.get("driver_id") or None,
            d.get("pickup_location"),
            d.get("drop_location"),
            d.get("truck_type"),
            d.get("goods_description"),
            d.get("weight"),
            agreed_rate,
            d.get("booking_date"),
            d.get("status", "Pending"),
            d.get("commission_type", "percent"),
            d.get("commission_value", 0),
            image_url,
            image_public_id,
            d.get("notes"),
        ),
    )
    conn.commit()
    new_id = cur.lastrowid
    cur.execute("SELECT * FROM bookings WHERE id=%s", (new_id,))
    row = cur.fetchone()
    cur.close()
    conn.close()

    # Step 5: acknowledgement back to the frontend
    return jsonify({"success": True, "message": "Booking created!", "booking": serialize_row(row)}), 201


@app.route("/api/bookings/<int:booking_id>", methods=["PUT"])
def update_booking(booking_id):
    d = request.form if request.form else (request.get_json(silent=True) or {})
    image_file = request.files.get("goods_image") if request.files else None

    fields, values = [], []
    editable = {
        "client_id": "client_id", "driver_id": "driver_id",
        "pickup_location": "pickup_location", "drop_location": "drop_location",
        "truck_type": "truck_type", "goods_description": "goods_description",
        "weight": "weight", "agreed_rate": "agreed_rate", "booking_date": "booking_date",
        "status": "status", "commission_type": "commission_type",
        "commission_value": "commission_value", "notes": "notes",
    }
    for key, col in editable.items():
        if key in d:
            fields.append(f"{col}=%s")
            values.append(d.get(key) or None)

    if image_file and image_file.filename:
        if not allowed_image(image_file.filename):
            return jsonify({"success": False, "message": "Image must be png/jpg/jpeg/webp"}), 400
        try:
            result = cloudinary.uploader.upload(image_file, folder="transport_broker/goods")
            fields += ["goods_image_url=%s", "goods_image_public_id=%s"]
            values += [result["secure_url"], result["public_id"]]
        except Exception as e:
            traceback.print_exc()
            return jsonify({"success": False, "message": f"Image upload failed: {e}"}), 500

    if not fields:
        return jsonify({"success": False, "message": "Nothing to update"}), 400

    conn = get_conn()
    cur = conn.cursor(dictionary=True)
    values.append(booking_id)
    cur.execute(f"UPDATE bookings SET {', '.join(fields)} WHERE id=%s", values)
    conn.commit()
    cur.execute("SELECT * FROM bookings WHERE id=%s", (booking_id,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return jsonify({"success": True, "message": "Booking updated!", "booking": serialize_row(row)})


@app.route("/api/bookings/<int:booking_id>/status", methods=["PATCH"])
def advance_status(booking_id):
    conn = get_conn()
    cur = conn.cursor(dictionary=True)
    cur.execute("SELECT status FROM bookings WHERE id=%s", (booking_id,))
    row = cur.fetchone()
    if not row:
        cur.close(); conn.close()
        return jsonify({"success": False, "message": "Booking not found"}), 404
    idx = STATUSES.index(row["status"]) if row["status"] in STATUSES else 0
    new_status = STATUSES[idx + 1] if idx < len(STATUSES) - 1 else row["status"]
    cur.execute("UPDATE bookings SET status=%s WHERE id=%s", (new_status, booking_id))
    conn.commit()
    cur.execute("SELECT * FROM bookings WHERE id=%s", (booking_id,))
    updated = cur.fetchone()
    cur.close()
    conn.close()
    return jsonify({"success": True, "message": f"Status moved to {new_status}", "booking": serialize_row(updated)})


@app.route("/api/bookings/<int:booking_id>/payment", methods=["PATCH"])
def record_payment(booking_id):
    d = request.get_json(silent=True) or {}
    conn = get_conn()
    cur = conn.cursor(dictionary=True)
    if d.get("payment_received") is not None:
        cur.execute(
            "UPDATE bookings SET payment_received=%s, payment_date=%s, payment_amount=%s WHERE id=%s",
            (bool(d["payment_received"]), d.get("payment_date", date.today().isoformat()),
             d.get("payment_amount", 0), booking_id),
        )
    if d.get("driver_paid") is not None:
        cur.execute(
            "UPDATE bookings SET driver_paid=%s, driver_paid_date=%s WHERE id=%s",
            (bool(d["driver_paid"]), d.get("driver_paid_date", date.today().isoformat()), booking_id),
        )
    conn.commit()
    cur.execute("SELECT * FROM bookings WHERE id=%s", (booking_id,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return jsonify({"success": True, "message": "Payment updated!", "booking": serialize_row(row)})


@app.route("/api/bookings/<int:booking_id>", methods=["DELETE"])
def delete_booking(booking_id):
    conn = get_conn()
    cur = conn.cursor(dictionary=True)
    cur.execute("SELECT goods_image_public_id FROM bookings WHERE id=%s", (booking_id,))
    row = cur.fetchone()
    if row and row.get("goods_image_public_id"):
        try:
            cloudinary.uploader.destroy(row["goods_image_public_id"])
        except Exception:
            pass  # non-fatal — booking delete should still proceed
    cur.execute("DELETE FROM bookings WHERE id=%s", (booking_id,))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({"success": True, "message": "Booking deleted!"})


# ---------------------------------------------------------------------------
# Dashboard / reports summary
# ---------------------------------------------------------------------------
@app.route("/api/dashboard", methods=["GET"])
def dashboard():
    conn = get_conn()
    cur = conn.cursor(dictionary=True)
    cur.execute("SELECT * FROM bookings")
    bookings = cur.fetchall()
    cur.close()
    conn.close()

    total_bookings = len(bookings)
    total_revenue = sum(float(b["agreed_rate"] or 0) for b in bookings)
    total_commission = sum(compute_commission(b["agreed_rate"], b["commission_type"], b["commission_value"]) for b in bookings)
    pending_payments = sum(1 for b in bookings if b["status"] == "Delivered" and not b["payment_received"])
    pending_driver_pay = sum(1 for b in bookings if b["payment_received"] and not b["driver_paid"])

    by_status = {s: 0 for s in STATUSES}
    for b in bookings:
        if b["status"] in by_status:
            by_status[b["status"]] += 1

    return jsonify({
        "total_bookings": total_bookings,
        "total_revenue": total_revenue,
        "total_commission": total_commission,
        "pending_payments": pending_payments,
        "pending_driver_pay": pending_driver_pay,
        "by_status": by_status,
    })


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=os.environ.get("FLASK_DEBUG", "1") == "1", host="0.0.0.0", port=port)