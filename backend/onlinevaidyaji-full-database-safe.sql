-- OnlineVaidyaJi Complete Database Schema
-- =========================================
-- Run this file once to create everything
-- NOTE: Create the database via Hostinger control panel first, then import this file.

-- â”€â”€â”€ CORE TABLES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20) NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('patient', 'doctor', 'admin') DEFAULT 'patient',
    image VARCHAR(500),
    is_active TINYINT(1) DEFAULT 1,
    is_verified TINYINT(1) DEFAULT 0,
    email_verification_token VARCHAR(255) DEFAULT NULL,
    email_verification_expires DATETIME DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_role (role)
);

-- Specializations Table
CREATE TABLE IF NOT EXISTS specializations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    icon VARCHAR(50),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Doctors Table
CREATE TABLE IF NOT EXISTS doctors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    slug VARCHAR(255) NULL UNIQUE,
    specialization_id INT,
    system VARCHAR(50) DEFAULT NULL,
    gender ENUM('male','female') DEFAULT NULL,
    qualification TEXT,
    experience INT,
    consultation_fee DECIMAL(10,2),
    about TEXT,
    bio TEXT,
    languages VARCHAR(500),
    city VARCHAR(100),
    is_available_online TINYINT(1) DEFAULT 1,
    is_available_offline TINYINT(1) DEFAULT 1,
    rating DECIMAL(3,2) DEFAULT 0,
    review_count INT DEFAULT 0,
    is_approved TINYINT(1) DEFAULT 0,
    is_restricted TINYINT(1) DEFAULT 0,
    restriction_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (specialization_id) REFERENCES specializations(id)
);

-- Doctor Specializations (Many-to-Many)
CREATE TABLE IF NOT EXISTS doctor_specializations (
    doctor_id INT NOT NULL,
    specialization_id INT NOT NULL,
    PRIMARY KEY (doctor_id, specialization_id),
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    FOREIGN KEY (specialization_id) REFERENCES specializations(id) ON DELETE CASCADE
);

-- Doctor Verifications Table
CREATE TABLE IF NOT EXISTS doctor_verifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NOT NULL,
    document_type VARCHAR(100),
    document_path VARCHAR(500),
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    notes TEXT,
    verified_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);

-- Appointments Table
CREATE TABLE IF NOT EXISTS appointments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NOT NULL,
    patient_id INT NOT NULL,
    appointment_date DATE NOT NULL,
    appointment_time TIME NOT NULL,
    type ENUM('online', 'offline') DEFAULT 'online',
    status ENUM('pending', 'confirmed', 'completed', 'cancelled') DEFAULT 'pending',
    symptoms TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id),
    FOREIGN KEY (patient_id) REFERENCES users(id),
    INDEX idx_doctor (doctor_id),
    INDEX idx_patient (patient_id),
    INDEX idx_date (appointment_date)
);

-- Appointment Slots Table
CREATE TABLE IF NOT EXISTS appointment_slots (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NOT NULL,
    day_of_week TINYINT(1),
    date DATE,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_available TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id)
);

-- Payments Table
CREATE TABLE IF NOT EXISTS payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    appointment_id INT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'INR',
    razorpay_payment_id VARCHAR(100),
    razorpay_order_id VARCHAR(100),
    status ENUM('pending', 'captured', 'failed', 'refunded') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id)
);

-- Reviews Table
CREATE TABLE IF NOT EXISTS reviews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NOT NULL,
    patient_id INT NOT NULL,
    appointment_id INT,
    rating TINYINT(1) NOT NULL,
    comment TEXT,
    is_approved TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id),
    FOREIGN KEY (patient_id) REFERENCES users(id),
    FOREIGN KEY (appointment_id) REFERENCES appointments(id),
    UNIQUE KEY unique_review (doctor_id, patient_id, appointment_id)
);

-- Medical Conditions Table
CREATE TABLE IF NOT EXISTS medical_conditions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Prescriptions Table (doctor prescriptions)
CREATE TABLE IF NOT EXISTS prescriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    appointment_id INT NOT NULL,
    prescription_text TEXT NOT NULL,
    medicines JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id)
);

-- Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    type VARCHAR(50),
    related_id INT DEFAULT NULL,
    related_type VARCHAR(50) DEFAULT NULL,
    is_read TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    INDEX idx_user_read (user_id, is_read)
);

-- Cities Table
CREATE TABLE IF NOT EXISTS cities (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    state VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Blogs Table
CREATE TABLE IF NOT EXISTS blogs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    content TEXT,
    excerpt TEXT,
    image VARCHAR(500),
    author_id INT,
    status ENUM('draft', 'published') DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES users(id)
);

-- FAQs Table
CREATE TABLE IF NOT EXISTS faqs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    category VARCHAR(100),
    sort_order INT DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Settings Table
CREATE TABLE IF NOT EXISTS settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Audit Logs Table
CREATE TABLE IF NOT EXISTS audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    action VARCHAR(100) NOT NULL,
    details TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Password Resets Table
CREATE TABLE IF NOT EXISTS password_resets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_token (token)
);

-- â”€â”€â”€ CONSULTATION TABLES (migrated) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- Doctor Online Status
CREATE TABLE IF NOT EXISTS doctor_status (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NOT NULL UNIQUE,
    status ENUM('online', 'offline', 'busy') DEFAULT 'offline',
    last_seen TIMESTAMP NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);

-- Consultation Rooms
CREATE TABLE IF NOT EXISTS consultation_rooms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    appointment_id INT NOT NULL UNIQUE,
    room_id VARCHAR(100) NOT NULL UNIQUE,
    doctor_id INT NOT NULL,
    patient_id INT NOT NULL,
    type ENUM('chat', 'video', 'both') DEFAULT 'both',
    status ENUM('active', 'completed', 'cancelled') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP NULL,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id),
    FOREIGN KEY (patient_id) REFERENCES users(id),
    INDEX idx_room_id (room_id),
    INDEX idx_appointment (appointment_id)
);

-- Chat Messages
CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    room_id VARCHAR(100) NOT NULL,
    sender_id INT NOT NULL,
    sender_role ENUM('doctor', 'patient') NOT NULL,
    message_type ENUM('text', 'image', 'file') DEFAULT 'text',
    content TEXT,
    file_url VARCHAR(500),
    file_name VARCHAR(255),
    file_size INT,
    is_read TINYINT(1) DEFAULT 0,
    read_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sender_id) REFERENCES users(id),
    INDEX idx_room (room_id),
    INDEX idx_sender (sender_id),
    INDEX idx_created (created_at)
);

-- Video Sessions
CREATE TABLE IF NOT EXISTS video_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    appointment_id INT NOT NULL,
    room_id VARCHAR(100) NOT NULL,
    doctor_id INT NOT NULL,
    patient_id INT NOT NULL,
    peer_id VARCHAR(255),
    status ENUM('initiated', 'active', 'completed', 'missed', 'failed') DEFAULT 'initiated',
    started_at TIMESTAMP NULL,
    ended_at TIMESTAMP NULL,
    duration_seconds INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id),
    FOREIGN KEY (patient_id) REFERENCES users(id),
    INDEX idx_appointment (appointment_id),
    INDEX idx_room (room_id)
);

-- â”€â”€â”€ PHARMACY TABLES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- Pharmacy Categories
CREATE TABLE IF NOT EXISTS pharmacy_categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    image VARCHAR(500),
    icon VARCHAR(50),
    parent_id INT DEFAULT NULL,
    sort_order INT DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES pharmacy_categories(id) ON DELETE SET NULL,
    INDEX idx_slug (slug),
    INDEX idx_active (is_active)
);

-- Pharmacy Brands
CREATE TABLE IF NOT EXISTS pharmacy_brands (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    image VARCHAR(500),
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pharmacy Products
CREATE TABLE IF NOT EXISTS pharmacy_products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    sku VARCHAR(100) UNIQUE,
    category_id INT,
    brand_id INT,
    description TEXT,
    benefits TEXT,
    ingredients TEXT,
    dosage_instructions TEXT,
    side_effects TEXT,
    stock_quantity INT DEFAULT 0,
    low_stock_threshold INT DEFAULT 10,
    mrp DECIMAL(10,2) NOT NULL,
    sale_price DECIMAL(10,2) NOT NULL,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    is_prescription_required TINYINT(1) DEFAULT 0,
    is_featured TINYINT(1) DEFAULT 0,
    is_best_seller TINYINT(1) DEFAULT 0,
    is_new_arrival TINYINT(1) DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    total_ratings INT DEFAULT 0,
    avg_rating DECIMAL(3,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES pharmacy_categories(id) ON DELETE SET NULL,
    FOREIGN KEY (brand_id) REFERENCES pharmacy_brands(id) ON DELETE SET NULL,
    INDEX idx_slug (slug),
    INDEX idx_category (category_id),
    INDEX idx_featured (is_featured),
    INDEX idx_best_seller (is_best_seller),
    INDEX idx_active (is_active),
    INDEX idx_prescription (is_prescription_required)
);

-- Product Images
CREATE TABLE IF NOT EXISTS product_images (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    image_url VARCHAR(500) NOT NULL,
    is_primary TINYINT(1) DEFAULT 0,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES pharmacy_products(id) ON DELETE CASCADE,
    INDEX idx_product (product_id)
);

-- Coupons (created before orders for FK reference)
CREATE TABLE IF NOT EXISTS coupons (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    type ENUM('percentage', 'flat', 'free_shipping') NOT NULL,
    value DECIMAL(10,2) DEFAULT 0,
    min_order_amount DECIMAL(10,2) DEFAULT 0,
    max_discount DECIMAL(10,2) DEFAULT NULL,
    usage_limit INT DEFAULT NULL,
    used_count INT DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    starts_at TIMESTAMP NULL,
    expires_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_code (code),
    INDEX idx_active (is_active)
);

-- Shipping Addresses
CREATE TABLE IF NOT EXISTS shipping_addresses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    mobile VARCHAR(20) NOT NULL,
    address_line1 VARCHAR(500) NOT NULL,
    address_line2 VARCHAR(500),
    city VARCHAR(100) NOT NULL,
    state VARCHAR(100) NOT NULL,
    pincode VARCHAR(10) NOT NULL,
    is_default TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user (user_id)
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id VARCHAR(50) UNIQUE NOT NULL,
    user_id INT NOT NULL,
    shipping_address_id INT,
    coupon_id INT DEFAULT NULL,
    subtotal DECIMAL(10,2) NOT NULL,
    discount DECIMAL(10,2) DEFAULT 0,
    gst DECIMAL(10,2) DEFAULT 0,
    shipping_charges DECIMAL(10,2) DEFAULT 0,
    total DECIMAL(10,2) NOT NULL,
    status ENUM('pending','confirmed','processing','packed','shipped','out_for_delivery','delivered','cancelled') DEFAULT 'pending',
    payment_status ENUM('pending','paid','failed','refunded') DEFAULT 'pending',
    payment_method VARCHAR(50),
    razorpay_order_id VARCHAR(100),
    razorpay_payment_id VARCHAR(100),
    prescription_id INT DEFAULT NULL,
    notes TEXT,
    estimated_delivery DATE,
    delivered_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (shipping_address_id) REFERENCES shipping_addresses(id) ON DELETE SET NULL,
    FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE SET NULL,
    INDEX idx_order_id (order_id),
    INDEX idx_user (user_id),
    INDEX idx_status (status),
    INDEX idx_payment (payment_status)
);

-- Order Items
CREATE TABLE IF NOT EXISTS order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    quantity INT NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES pharmacy_products(id),
    INDEX idx_order (order_id)
);

-- Shopping Carts
CREATE TABLE IF NOT EXISTS carts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    coupon_id INT DEFAULT NULL,
    subtotal DECIMAL(10,2) DEFAULT 0,
    discount DECIMAL(10,2) DEFAULT 0,
    gst DECIMAL(10,2) DEFAULT 0,
    shipping_charges DECIMAL(10,2) DEFAULT 0,
    total DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_cart (user_id)
);

-- Cart Items
CREATE TABLE IF NOT EXISTS cart_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    cart_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT DEFAULT 1,
    price DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES pharmacy_products(id) ON DELETE CASCADE,
    INDEX idx_cart (cart_id)
);

-- Wishlists
CREATE TABLE IF NOT EXISTS wishlists (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    product_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES pharmacy_products(id) ON DELETE CASCADE,
    UNIQUE KEY unique_wishlist (user_id, product_id)
);

-- Coupon Usage
CREATE TABLE IF NOT EXISTS coupon_usage (
    id INT AUTO_INCREMENT PRIMARY KEY,
    coupon_id INT NOT NULL,
    user_id INT NOT NULL,
    order_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
    INDEX idx_coupon (coupon_id),
    INDEX idx_user (user_id)
);

-- Product Reviews
CREATE TABLE IF NOT EXISTS product_reviews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    user_id INT NOT NULL,
    order_id INT,
    rating TINYINT(1) NOT NULL,
    review_text TEXT,
    images JSON,
    is_approved TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES pharmacy_products(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
    UNIQUE KEY unique_review (product_id, user_id, order_id),
    INDEX idx_product (product_id),
    INDEX idx_approved (is_approved)
);

-- Prescription Uploads (patient uploaded)
CREATE TABLE IF NOT EXISTS prescription_uploads (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    appointment_id INT DEFAULT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_type ENUM('pdf', 'image') NOT NULL,
    notes TEXT,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    admin_notes TEXT,
    reviewed_by INT DEFAULT NULL,
    reviewed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE SET NULL,
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user (user_id),
    INDEX idx_status (status)
);

-- Inventory Logs
CREATE TABLE IF NOT EXISTS inventory_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    product_id INT NOT NULL,
    user_id INT,
    change_type ENUM('restock', 'sale', 'return', 'adjustment') NOT NULL,
    quantity_change INT NOT NULL,
    quantity_after INT NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES pharmacy_products(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_product (product_id),
    INDEX idx_created (created_at)
);

-- â”€â”€â”€ SEED DATA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- Insert default specializations
INSERT IGNORE INTO specializations (name, icon, description) VALUES
('Sex Problem', 'ðŸ©º', 'Sex Problem Treatment'),
("Women's Health", 'ðŸ‘©â€âš•ï¸', "Women's Health & Gynecology"),
('Orthopedics', 'ðŸ¦´', 'Orthopedics & Joint Care'),
('Skin & Hair', 'âœ¨', 'Skin & Hair Care'),
('Digestive Health', 'ðŸ«ƒ', 'Digestive & Gastrointestinal'),
('Mental Health', 'ðŸ§ ', 'Stress & Mental Health'),
('Heart Care', 'â¤ï¸', 'Heart Care'),
('Gut Health', 'ðŸ’‰', 'Gut Health Treatment'),
('Respiratory', 'ðŸ«', 'Respiratory Care'),
('Pediatrics', 'ðŸ‘¶', 'Pediatrics'),
('Eye Care', 'ðŸ‘ï¸', 'Eye Care'),
('ENT', 'ðŸ‘‚', 'Ear, Nose & Throat');

-- Insert default cities
INSERT IGNORE INTO cities (name, state) VALUES
('Delhi', 'Delhi NCR'),
('Mumbai', 'Maharashtra'),
('Bangalore', 'Karnataka'),
('Hyderabad', 'Telangana'),
('Chennai', 'Tamil Nadu'),
('Pune', 'Maharashtra'),
('Ahmedabad', 'Gujarat'),
('Kolkata', 'West Bengal'),
('Jaipur', 'Rajasthan'),
('Lucknow', 'Uttar Pradesh');

-- Insert default settings
INSERT IGNORE INTO settings (setting_key, setting_value) VALUES
('site_name', 'OnlineVaidyaJi'),
('site_email', 'info@onlinevaidyaji.com'),
('site_phone', '+91 84680 08464'),
('site_address', 'B-128, Sector 2, Noida, Gautambuddha Nagar, Uttar Pradesh - 201301'),
('commission_rate', '10'),
('support_whatsapp', '+918468008464');

-- Insert admin user (password: admin123)
INSERT IGNORE INTO users (name, email, phone, password, role) VALUES
('Admin', 'admin@onlinevaidyaji.com', '+919999999999', '$2a$10$aLtnqvksmR/EZbjLZ17lXeLK3v6jPaLmajVL8wkrKChwpQKIFX1Uq', 'admin');



-- â”€â”€â”€ PHARMACY SEED DATA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- Insert Default Categories
INSERT IGNORE INTO pharmacy_categories (name, slug, description, icon, sort_order) VALUES
('Ayurvedic Medicines', 'ayurvedic-medicines', 'Traditional Ayurvedic formulations and remedies', 'ðŸŒ¿', 1),
('Homeopathy Medicines', 'homeopathy-medicines', 'Homeopathic remedies and treatments', 'ðŸ’§', 2),
('Unani Medicines', 'unani-medicines', 'Unani system of medicine products', 'ðŸº', 3),
('Siddha Medicines', 'siddha-medicines', 'Siddha medicine formulations', 'ðŸ”¥', 4),
('Herbal Supplements', 'herbal-supplements', 'Natural herbal supplements for wellness', 'ðŸŒ±', 5),
('Immunity Boosters', 'immunity-boosters', 'Products to boost your immune system', 'ðŸ›¡ï¸', 6),
('Personal Care', 'personal-care', 'Natural personal care products', 'ðŸ§´', 7),
('Health Devices', 'health-devices', 'Health monitoring and wellness devices', 'ðŸ©º', 8);

-- Insert Default Brands
INSERT IGNORE INTO pharmacy_brands (name, slug, description) VALUES
('OnlineVaidyaJi', 'onlinevaidyaji', 'OnlineVaidyaJi'),
('Dabur', 'dabur', 'Dabur Ayurvedic Products'),
('Patanjali', 'patanjali', 'Patanjali Ayurved Products'),
('Baidyanath', 'baidyanath', 'Baidyanath Ayurvedic Formulations'),
('Zandu', 'zandu', 'Zandu Ayurvedic Medicines'),
('Himalaya', 'himalaya', 'Himalaya Wellness Products'),
('Sri Sri Tattva', 'sri-sri-tattva', 'Sri Sri Ayurveda Products'),
('Kerala Ayurveda', 'kerala-ayurveda', 'Kerala Ayurveda Pharmacy');

-- Insert Sample Products
INSERT IGNORE INTO pharmacy_products (name, slug, sku, category_id, brand_id, description, benefits, ingredients, dosage_instructions, stock_quantity, mrp, sale_price, discount_percent, is_featured, is_best_seller, is_new_arrival) VALUES
('Triphala Churna', 'triphala-churna', 'OV-TC-001', 1, 1, 'A classical Ayurvedic formulation combining three potent fruits for digestive health and detoxification.', 'Improves digestion, natural detox, rich in Vitamin C, supports regular bowel movements', 'Amalaki (Emblica officinalis), Bibhitaki (Terminalia bellirica), Haritaki (Terminalia chebula)', 'Take 1 teaspoon with warm water before bedtime', 500, 299, 199, 33.44, 1, 1, 0),
('Ashwagandha Capsules', 'ashwagandha-capsules', 'OV-AC-002', 1, 1, 'Organic Ashwagandha root extract capsules for stress relief and vitality.', 'Reduces stress and anxiety, boosts energy, improves focus, enhances stamina', 'Organic Ashwagandha (Withania somnifera) root extract 500mg', 'Take 1 capsule twice daily with water after meals', 350, 499, 349, 30.06, 1, 1, 0),
('Chyawanprash', 'chyawanprash', 'OV-CP-003', 5, 2, 'Traditional Ayurvedic health supplement made from amla and 40+ herbs.', 'Boosts immunity, improves vitality, rich in antioxidants, supports respiratory health', 'Amla, Ashwagandha, Shatavari, Guduchi, 40+ herbal ingredients', 'Take 1 teaspoon twice daily with warm milk or water', 200, 399, 299, 25.06, 1, 1, 1),
('Brahmi Oil', 'brahmi-oil', 'OV-BO-004', 7, 1, 'Herbal hair oil enriched with Brahmi for hair growth and scalp health.', 'Promotes hair growth, reduces hair fall, improves scalp health, cools the mind', 'Brahmi (Bacopa monnieri), Coconut oil, Bhringraj, Amla', 'Apply to scalp and hair gently. Leave for 30 mins or overnight', 150, 349, 249, 28.65, 0, 1, 0),
('Shilajit Resin', 'shilajit-resin', 'OV-SR-005', 1, 1, 'Pure Himalayan Shilajit resin for strength and vitality.', 'Enhances physical performance, boosts energy, supports reproductive health, anti-aging', '100% Pure Himalayan Shilajit', 'Take a pea-sized amount with warm milk or water once daily', 100, 799, 599, 25.03, 1, 0, 0),
('Neem Tablets', 'neem-tablets', 'OV-NT-006', 1, 6, 'Standardized Neem extract tablets for blood purification and skin health.', 'Purifies blood, supports skin health, boosts immunity, natural detox', 'Neem (Azadirachta indica) extract 500mg', 'Take 1 tablet twice daily after meals', 400, 249, 199, 20.08, 0, 0, 1),
('Tulsi Drops', 'tulsi-drops', 'OV-TD-007', 5, 1, 'Concentrated Tulsi (Holy Basil) drops for respiratory and immune support.', 'Supports respiratory health, boosts immunity, reduces stress, natural adaptogen', 'Tulsi (Ocimum sanctum) extract', 'Mix 10-15 drops in water twice daily', 300, 199, 149, 25.13, 0, 0, 0),
('Pancharishta', 'pancharishta', 'OV-PA-008', 1, 4, 'Traditional Ayurvedic tonic for digestive and women''s health.', 'Improves digestion, supports women''s reproductive health, detoxifies blood', 'Dashamoola, Amla, Haritaki, Bibhitaki, Jaggery, Dhataki flower', 'Take 15-20 ml with equal water after meals twice daily', 80, 449, 399, 11.14, 0, 0, 0),
('Immunity Boost Kit', 'immunity-boost-kit', 'OV-IBK-009', 6, 1, 'Complete immunity boosting kit with Chyawanprash, Tulsi drops, and Vitamin C.', 'Complete immune support, 3 products in 1 kit, great value', 'Chyawanprash (500g), Tulsi Drops (30ml), Vitamin C Tablets (60)', 'As directed on individual products', 75, 899, 699, 22.25, 1, 1, 1),
('Aloe Vera Juice', 'aloe-vera-juice', 'OV-AVJ-010', 7, 6, 'Pure aloe vera juice for digestive health and skin glow.', 'Supports digestion, hydrates skin, natural detox, rich in antioxidants', 'Pure Aloe Vera (Aloe barbadensis) inner leaf juice', 'Drink 30ml with water on empty stomach daily', 200, 349, 249, 28.65, 0, 0, 1);

-- Contact Messages
CREATE TABLE IF NOT EXISTS contact_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  subject VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  is_read TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add product images
INSERT IGNORE INTO product_images (product_id, image_url, is_primary) VALUES
(1, '/pharmacy/triphala-churna.jpg', 1),
(2, '/pharmacy/ashwagandha-capsules.jpg', 1),
(3, '/pharmacy/chyawanprash.jpg', 1),
(4, '/pharmacy/brahmi-oil.jpg', 1),
(5, '/pharmacy/shilajit-resin.jpg', 1),
(6, '/pharmacy/neem-tablets.jpg', 1),
(7, '/pharmacy/tulsi-drops.jpg', 1),
(8, '/pharmacy/pancharishta.jpg', 1),
(9, '/pharmacy/immunity-kit.jpg', 1),
(10, '/pharmacy/aloe-vera-juice.jpg', 1);
-- â”€â”€â”€ APP TABLES (converted from MongoDB â†’ MySQL, styled like the website) â”€â”€â”€â”€â”€â”€â”€â”€
-- NOTE: To match the website, all app tables now use INT AUTO_INCREMENT ids and
-- real FOREIGN KEYS to the website's users(id) / doctors(id) tables.
-- The app backend (Python/server.py) must stop using UUID strings and use the
-- INT id returned by MySQL after INSERT (LAST_INSERT_ID()).

-- â”€â”€â”€ ONBOARDING: Prakriti Quiz â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- Quiz Results (Prakriti quiz outcome per user, idempotent)
CREATE TABLE IF NOT EXISTS quiz_results (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    answers JSON,
    dosha_scores JSON,
    prakriti_result VARCHAR(50),
    recommended_kit VARCHAR(255),
    language VARCHAR(10) DEFAULT 'en',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_quiz_user (user_id),
    INDEX idx_quiz_created (created_at)
);

-- Quiz Attempts (older engagement quiz)
CREATE TABLE IF NOT EXISTS quiz_attempts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    answers JSON,
    score INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_attempt_user (user_id)
);

-- Prakriti Assessments (doctor-issued prakriti reviews)
CREATE TABLE IF NOT EXISTS prakriti_assessments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    doctor_id INT,
    dosha_scores JSON,
    prakriti_result VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE SET NULL,
    INDEX idx_pra_user (user_id),
    INDEX idx_pra_doctor (doctor_id)
);

-- â”€â”€â”€ CRM: Presales Leads â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- NOTE: App health_documents/prescription_uploads â†’ uses website "prescription_uploads" table.

-- Presales Leads (admin CRM queue for new signups awaiting first call)
CREATE TABLE IF NOT EXISTS presales_leads (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    status ENUM('new', 'contacted', 'converted', 'lost') DEFAULT 'new',
    agent_name VARCHAR(255),
    status_history JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_lead_status (status),
    INDEX idx_lead_created (created_at)
);

-- Leads (legacy lead-form submissions)
CREATE TABLE IF NOT EXISTS leads (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(20),
    source VARCHAR(100),
    message TEXT,
    status ENUM('new', 'contacted', 'converted', 'closed') DEFAULT 'new',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- â”€â”€â”€ PATIENT HEALTH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- Patient Profiles (editable patient bio: age, gender, dosha, conditions)
CREATE TABLE IF NOT EXISTS patient_profiles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    age INT,
    gender VARCHAR(20),
    dosha VARCHAR(20),
    conditions JSON,
    lifestyle VARCHAR(255),
    address TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_profile_user (user_id)
);

-- Family Members (family accounts under one patient)
CREATE TABLE IF NOT EXISTS family_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    relationship VARCHAR(100),
    age INT,
    gender VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_family_user (user_id)
);

-- Reminders (medication reminders)
CREATE TABLE IF NOT EXISTS reminders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    medicine_name VARCHAR(255),
    dosage VARCHAR(100),
    times JSON,
    notes TEXT,
    scheduled_at TIMESTAMP NULL,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_rem_user (user_id),
    INDEX idx_rem_scheduled (scheduled_at)
);

-- Chat Messages (LEGACY - replaced by ai_chat_messages below; kept so old rows
-- are not lost. New AI chat messages are written to ai_chat_messages.)
CREATE TABLE IF NOT EXISTS chat_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    session_id VARCHAR(100) NOT NULL,
    role ENUM('user', 'assistant') NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_chat_user (user_id),
    INDEX idx_chat_session (user_id, created_at)
);

-- AI Chat Messages (unified store for every in-app AI conversation)
--   source = 'chatbot'  -> AI VaidyaJi health chatbot (POST /chat/message)
--   source = 'support'  -> VaidyaJi Support chat      (POST /support/chat)
-- user_id is NULL for anonymous support-chat users. This table is SEPARATE from
-- contact_messages, which belongs to the website contact form only.
CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    session_id VARCHAR(100) NOT NULL,
    role ENUM('user', 'assistant') NOT NULL,
    source ENUM('chatbot', 'support') NOT NULL DEFAULT 'chatbot',
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ai_chat_session (session_id, created_at),
    INDEX idx_ai_chat_user (user_id, created_at),
    INDEX idx_ai_chat_source (source, created_at)
);

-- Wellness Logs (daily wellness diary entries)
CREATE TABLE IF NOT EXISTS wellness_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    log_date DATE NOT NULL,
    mood INT,
    sleep_hours DECIMAL(3,1),
    water_glasses INT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_well_user (user_id),
    INDEX idx_well_date (log_date)
);

-- â”€â”€â”€ WOMEN'S HEALTH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- Women Cycles (period tracking)
CREATE TABLE IF NOT EXISTS women_cycles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    last_period_start DATE,
    cycle_length INT,
    period_length INT,
    symptoms JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_cyc_user (user_id)
);

-- Women Pregnancy (pregnancy tracker)
CREATE TABLE IF NOT EXISTS women_pregnancy (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    trimester INT,
    due_date DATE,
    weight DECIMAL(5,2),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_preg_user (user_id)
);

-- Women Gynae (gynae Q&A)
CREATE TABLE IF NOT EXISTS women_gynae (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    question TEXT,
    answer TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_gynae_user (user_id)
);

-- â”€â”€â”€ CATALOG: Lab (app side) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- NOTE: App medicines/medicine_orders â†’ website uses "pharmacy_products" + "orders"/"order_items" tables.

-- Lab Tests (lab test catalog)
CREATE TABLE IF NOT EXISTS lab_tests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    price DECIMAL(10,2) DEFAULT 0,
    description TEXT,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Lab Bookings
CREATE TABLE IF NOT EXISTS lab_bookings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    test_id INT,
    test_name VARCHAR(255),
    appointment_date DATE,
    slot VARCHAR(50),
    amount DECIMAL(10,2) DEFAULT 0,
    status ENUM('pending', 'confirmed', 'completed', 'cancelled') DEFAULT 'pending',
    paid TINYINT(1) DEFAULT 0,
    razorpay_payment_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (test_id) REFERENCES lab_tests(id) ON DELETE SET NULL,
    INDEX idx_lab_user (user_id),
    INDEX idx_lab_status (status)
);

-- â”€â”€â”€ YOGA & DIET â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- Yoga Sessions (curated yoga video catalog)
CREATE TABLE IF NOT EXISTS yoga_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    description TEXT,
    video_url VARCHAR(500),
    thumbnail_url VARCHAR(500),
    duration_minutes INT DEFAULT 0,
    sequence JSON,
    dosha_tags JSON,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_yoga_category (category)
);

-- Yoga Logs (session logs + streak tracking)
CREATE TABLE IF NOT EXISTS yoga_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    session_id INT,
    session_title VARCHAR(255),
    duration_minutes INT DEFAULT 0,
    logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_yogalog_user (user_id),
    INDEX idx_yogalog_date (logged_at)
);

-- Diet Plans (AI-generated AYUSH meal plans, structured + text)
CREATE TABLE IF NOT EXISTS diet_plans (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    dosha VARCHAR(20),
    goal VARCHAR(100),
    duration_days INT DEFAULT 1,
    plan_structured JSON,
    plan_text TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_diet_user (user_id)
);

-- â”€â”€â”€ GAMIFICATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- Challenges (30-day challenges catalog)
CREATE TABLE IF NOT EXISTS challenges (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    duration_days INT DEFAULT 30,
    badge VARCHAR(255),
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User Challenges (per-user challenge progress)
CREATE TABLE IF NOT EXISTS user_challenges (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    challenge_id INT NOT NULL,
    progress JSON,
    status ENUM('active', 'completed', 'abandoned') DEFAULT 'active',
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE,
    INDEX idx_uc_user (user_id),
    INDEX idx_uc_challenge (challenge_id)
);

-- User Engagement (streaks + coins + points ledger)
CREATE TABLE IF NOT EXISTS user_engagement (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    points INT DEFAULT 0,
    coins INT DEFAULT 0,
    streak_days INT DEFAULT 0,
    last_active DATE,
    ledger JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_eng_user (user_id)
);

-- â”€â”€â”€ PATIENT COMMUNITY (open) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- Community Posts
CREATE TABLE IF NOT EXISTS community_posts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255),
    content TEXT,
    image_url VARCHAR(500),
    likes_count INT DEFAULT 0,
    comments_count INT DEFAULT 0,
    is_pinned TINYINT(1) DEFAULT 0,
    is_hidden TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_cpost_created (created_at)
);

-- Community Comments
CREATE TABLE IF NOT EXISTS community_comments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    post_id INT NOT NULL,
    user_id INT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_ccom_post (post_id)
);

-- Community Likes
CREATE TABLE IF NOT EXISTS community_likes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    post_id INT NOT NULL,
    user_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_clike (post_id, user_id)
);

-- â”€â”€â”€ DOCTOR COMMUNITY (Vaidya Charcha) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- Doctor Community Posts
CREATE TABLE IF NOT EXISTS doc_com_posts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NOT NULL,
    content TEXT,
    image_url VARCHAR(500),
    privacy ENUM('public', 'community', 'private') DEFAULT 'community',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    INDEX idx_dcpost_created (created_at)
);

-- Doctor Community Comments
CREATE TABLE IF NOT EXISTS doc_com_comments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    post_id INT NOT NULL,
    doctor_id INT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES doc_com_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    INDEX idx_dccom_post (post_id)
);

-- Doctor Community Likes
CREATE TABLE IF NOT EXISTS doc_com_likes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    post_id INT NOT NULL,
    doctor_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES doc_com_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    UNIQUE KEY unique_dclike (post_id, doctor_id)
);

-- Doctor Community Saves (bookmarked posts)
CREATE TABLE IF NOT EXISTS doc_com_saves (
    id INT AUTO_INCREMENT PRIMARY KEY,
    post_id INT NOT NULL,
    doctor_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES doc_com_posts(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    UNIQUE KEY unique_dcsave (post_id, doctor_id)
);

-- Doctor Follows (doctor â†’ doctor follow graph)
CREATE TABLE IF NOT EXISTS doc_com_follows (
    id INT AUTO_INCREMENT PRIMARY KEY,
    follower_id INT NOT NULL,
    following_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (follower_id) REFERENCES doctors(id) ON DELETE CASCADE,
    FOREIGN KEY (following_id) REFERENCES doctors(id) ON DELETE CASCADE,
    UNIQUE KEY unique_follow (follower_id, following_id)
);

-- Doctor Community Reels (short-video reels)
CREATE TABLE IF NOT EXISTS doc_com_reels (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NOT NULL,
    title VARCHAR(255),
    video_url VARCHAR(500),
    thumbnail_url VARCHAR(500),
    description TEXT,
    likes_count INT DEFAULT 0,
    views_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    INDEX idx_reels_created (created_at)
);

-- Reel Likes
CREATE TABLE IF NOT EXISTS doc_com_reel_likes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reel_id INT NOT NULL,
    doctor_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reel_id) REFERENCES doc_com_reels(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    UNIQUE KEY unique_reellike (reel_id, doctor_id)
);

-- Reel Views
CREATE TABLE IF NOT EXISTS doc_com_reel_views (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reel_id INT NOT NULL,
    doctor_id INT NOT NULL,
    viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reel_id) REFERENCES doc_com_reels(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    UNIQUE KEY unique_reelview (reel_id, doctor_id)
);

-- Stories (24h ephemeral)
CREATE TABLE IF NOT EXISTS doc_com_stories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    doctor_id INT NOT NULL,
    media_url VARCHAR(500),
    media_type ENUM('image', 'video') DEFAULT 'image',
    caption TEXT,
    expires_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    INDEX idx_stories_exp (expires_at)
);

-- Story Views
CREATE TABLE IF NOT EXISTS doc_com_story_views (
    id INT AUTO_INCREMENT PRIMARY KEY,
    story_id INT NOT NULL,
    doctor_id INT NOT NULL,
    viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (story_id) REFERENCES doc_com_stories(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
    UNIQUE KEY unique_storyview (story_id, doctor_id)
);

-- DM Threads (1:1 between doctors)
-- NOTE: App dm_messages â†’ website "messages" table (thread_id stores as room_id).
CREATE TABLE IF NOT EXISTS doc_com_dm_threads (
    id INT AUTO_INCREMENT PRIMARY KEY,
    participants JSON,
    last_message_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- In-app Notifications (doctor community)
-- NOTE: App doc_com_notifications â†’ website "notifications" table (body â†’ message).

-- Moderation Reports (doctor community)
CREATE TABLE IF NOT EXISTS doc_com_reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reported_by INT NOT NULL,
    reported_type ENUM('post', 'comment', 'reel', 'story', 'dm') NOT NULL,
    reported_id INT NOT NULL,
    reason TEXT,
    status ENUM('pending', 'resolved', 'dismissed') DEFAULT 'pending',
    handled_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reported_by) REFERENCES doctors(id) ON DELETE CASCADE,
    FOREIGN KEY (handled_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_report_status (status)
);

-- â”€â”€â”€ ADMIN / ANALYTICS / INTERNAL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- NOTE: App activity â†’ website "audit_logs" table. The app's AI support chat
-- uses its own "support_messages" table (auto-created by the app) and does NOT
-- write to "contact_messages" (that table is for the website contact form).

-- Analytics (rollup counters + timestamps for the dashboard)
CREATE TABLE IF NOT EXISTS analytics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    metric_key VARCHAR(100) NOT NULL,
    metric_value JSON,
    window_start TIMESTAMP NULL,
    window_end TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_analytics_key (metric_key)
);

-- Feed (legacy home-screen feed items)
CREATE TABLE IF NOT EXISTS feed (
    id INT AUTO_INCREMENT PRIMARY KEY,
    item_type VARCHAR(50),
    item_id INT,
    title VARCHAR(255),
    subtitle VARCHAR(255),
    image_url VARCHAR(500),
    sort_order INT DEFAULT 0,
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Reports (admin-side incident reports)
CREATE TABLE IF NOT EXISTS reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    reported_by INT,
    subject VARCHAR(255),
    description TEXT,
    status ENUM('open', 'in_progress', 'resolved', 'closed') DEFAULT 'open',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE SET NULL
);

