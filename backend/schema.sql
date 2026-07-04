-- Transport Broker Management System - MySQL Schema
-- Run this once: mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS transport_broker;
USE transport_broker;

CREATE TABLE IF NOT EXISTS drivers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(15) NOT NULL,
  truck_type VARCHAR(50),
  truck_number VARCHAR(30),
  bank_name VARCHAR(50),
  bank_account VARCHAR(30),
  upi VARCHAR(50),
  ifsc VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  company VARCHAR(100),
  phone VARCHAR(15) NOT NULL,
  city VARCHAR(50),
  address VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bilti_no VARCHAR(30) UNIQUE,
  client_id INT NOT NULL,
  driver_id INT NULL,
  pickup_location VARCHAR(100) NOT NULL,
  drop_location VARCHAR(100) NOT NULL,
  truck_type VARCHAR(50),
  goods_description VARCHAR(255),
  weight VARCHAR(30),
  agreed_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
  booking_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'Pending',
  commission_type VARCHAR(10) NOT NULL DEFAULT 'percent',
  commission_value DECIMAL(10,2) NOT NULL DEFAULT 0,
  payment_received BOOLEAN DEFAULT FALSE,
  payment_date DATE NULL,
  payment_amount DECIMAL(10,2) DEFAULT 0,
  driver_paid BOOLEAN DEFAULT FALSE,
  driver_paid_date DATE NULL,
  goods_image_url VARCHAR(500) NULL,
  goods_image_public_id VARCHAR(255) NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
  FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL
);

-- Sample seed data (same as original app's demo data) -------------------
INSERT INTO drivers (name, phone, truck_type, truck_number, bank_name, bank_account, upi, ifsc) VALUES
('Ramesh Kumar','9876543210','Container','UP32 AB 1234','SBI','1234567890','ramesh@upi','SBIN0001234'),
('Suresh Yadav','9765432109','Trailer','UP80 CD 5678','HDFC','0987654321','suresh@upi','HDFC0001234'),
('Mohan Singh','9654321098','Open Truck','DL01 EF 9012','Axis','1122334455','mohan@upi','AXIS0001234'),
('Vijay Patel','9543210987','Mini Truck','MH04 GH 3456','ICICI','5544332211','vijay@upi','ICIC0001234');

INSERT INTO clients (name, company, phone, city, address) VALUES
('Rajesh Sharma','Sharma Traders','9111222333','Noida','Sector 18, Noida'),
('Amit Agarwal','Agarwal Exports','9222333444','Delhi','Karol Bagh, Delhi'),
('Priya Industries','Priya Industries','9333444555','Pune','MIDC, Pune'),
('Kumar Logistics','Kumar & Sons','9444555666','Lucknow','Transport Nagar'),
('Delhi Steel Corp','Delhi Steel Corp','9555666777','Delhi','Rohini, Delhi');