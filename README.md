# TransportFlow — Transport Broker Management System

A full-stack web application for transport brokers to manage bookings, drivers,
clients, and payments — with real-time commission tracking and cloud-based
document/photo storage.

## Features

- **Booking Management** — create, edit, and track shipments from pickup to
  delivery with a live status pipeline (Pending → Driver Assigned → Goods
  Loaded → In Transit → Delivered → Payment Received)
- **Driver & Client Directory** — store contact details, bank/UPI info, and
  view trip history per driver or client
- **Payments Dashboard** — track pending client payments and pending driver
  payouts in one place
- **Reports** — revenue trend chart, top clients by revenue, and booking
  status breakdown
- **Cloud Image Uploads** — attach a photo of the goods to each booking,
  stored on Cloudinary
- **PIN-based Login** — lightweight authentication for single-user/small-team
  use

## Tech Stack

| Layer     | Technology                          |
|-----------|--------------------------------------|
| Frontend  | HTML, CSS, JavaScript (vanilla, no framework) |
| Backend   | Python, Flask (REST API)             |
| Database  | MySQL                                |
| Storage   | Cloudinary (image hosting)           |

## Architecture

```
Browser (HTML/CSS/JS)
      │  fetch() / multipart form-data
      ▼
Flask REST API  ──▶  validates request
      │
      ├──▶ Cloudinary (if an image is attached) ──▶ returns hosted URL
      │
      ▼
MySQL  (booking saved with the image URL)
      │
      ▼
JSON response ──▶ Browser (UI updates, confirmation shown)
```

## Project Structure

```
transport-app/
├── backend/
│   ├── app.py              # Flask API — all routes (bookings, drivers, clients, payments)
│   ├── schema.sql          # MySQL schema + seed data
│   ├── requirements.txt
│   ├── Procfile            # production start command (gunicorn)
│   └── .env.example        # environment variable template
└── frontend/
    ├── index.html
    ├── style.css
    └── app.js
```

## Getting Started (local development)

### 1. Database

```bash
mysql -u root -p < backend/schema.sql
```

### 2. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env          # then fill in your MySQL + Cloudinary credentials
python app.py
```

The API runs on `http://localhost:5000`.

### 3. Frontend

```bash
cd frontend
python -m http.server 8000
```

Open `http://localhost:8000` in your browser. Default login PIN is `1234`
(configurable via `APP_PIN` in `.env`).

## Environment Variables

See `backend/.env.example` for the full list — MySQL connection details,
Cloudinary credentials, and the login PIN.

## License

This project is for personal/portfolio use.
