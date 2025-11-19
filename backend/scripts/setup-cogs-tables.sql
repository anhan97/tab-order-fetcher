-- Setup script for normalized COGS tables
-- Run this script to create the COGS database schema

-- Create countries table
CREATE TABLE IF NOT EXISTS countries (
    id VARCHAR(255) PRIMARY KEY,
    code VARCHAR(2) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Create shipping_companies table
CREATE TABLE IF NOT EXISTS shipping_companies (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    display_name VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Create variant_costs table
CREATE TABLE IF NOT EXISTS variant_costs (
    id VARCHAR(255) PRIMARY KEY,
    variant_id BIGINT NOT NULL,
    country_id VARCHAR(255) NOT NULL,
    shipping_company_id VARCHAR(255) NOT NULL,
    cost DECIMAL(10,2) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (country_id) REFERENCES countries(id) ON DELETE CASCADE,
    FOREIGN KEY (shipping_company_id) REFERENCES shipping_companies(id) ON DELETE CASCADE,
    UNIQUE KEY unique_variant_country_shipping (variant_id, country_id, shipping_company_id)
);

-- Create combos table
CREATE TABLE IF NOT EXISTS combos (
    id VARCHAR(255) PRIMARY KEY,
    combo_id VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    trigger_quantity INT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Create combo_items table
CREATE TABLE IF NOT EXISTS combo_items (
    id VARCHAR(255) PRIMARY KEY,
    combo_id VARCHAR(255) NOT NULL,
    variant_id BIGINT NOT NULL,
    quantity INT NOT NULL,
    FOREIGN KEY (combo_id) REFERENCES combos(id) ON DELETE CASCADE,
    UNIQUE KEY unique_combo_variant (combo_id, variant_id)
);

-- Create combo_overrides table
CREATE TABLE IF NOT EXISTS combo_overrides (
    id VARCHAR(255) PRIMARY KEY,
    combo_id VARCHAR(255) NOT NULL,
    country_id VARCHAR(255) NOT NULL,
    shipping_company_id VARCHAR(255) NOT NULL,
    override_cost DECIMAL(10,2) NULL,
    discount_type VARCHAR(20) NULL,
    discount_value DECIMAL(10,2) NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (combo_id) REFERENCES combos(id) ON DELETE CASCADE,
    FOREIGN KEY (country_id) REFERENCES countries(id) ON DELETE CASCADE,
    FOREIGN KEY (shipping_company_id) REFERENCES shipping_companies(id) ON DELETE CASCADE,
    UNIQUE KEY unique_combo_country_shipping (combo_id, country_id, shipping_company_id)
);

-- Insert default countries
INSERT IGNORE INTO countries (id, code, name, currency) VALUES
('country_us', 'US', 'United States', 'USD'),
('country_ca', 'CA', 'Canada', 'CAD'),
('country_au', 'AU', 'Australia', 'AUD'),
('country_uk', 'UK', 'United Kingdom', 'GBP'),
('country_de', 'DE', 'Germany', 'EUR'),
('country_fr', 'FR', 'France', 'EUR'),
('country_it', 'IT', 'Italy', 'EUR'),
('country_es', 'ES', 'Spain', 'EUR');

-- Insert default shipping companies
INSERT IGNORE INTO shipping_companies (id, name, display_name) VALUES
('shipping_yuntu', 'YunTu', 'YunTu Express'),
('shipping_shengtu', 'Shengtu Logistics', 'Shengtu Logistics'),
('shipping_yuanpeng', 'Yuanpeng Logistics', 'Yuanpeng Logistics'),
('shipping_dhl', 'DHL', 'DHL Express'),
('shipping_fedex', 'FedEx', 'FedEx Express'),
('shipping_ups', 'UPS', 'UPS Express');

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_variant_costs_variant_id ON variant_costs(variant_id);
CREATE INDEX IF NOT EXISTS idx_variant_costs_country_shipping ON variant_costs(country_id, shipping_company_id);
CREATE INDEX IF NOT EXISTS idx_combo_items_combo_id ON combo_items(combo_id);
CREATE INDEX IF NOT EXISTS idx_combo_items_variant_id ON combo_items(variant_id);
CREATE INDEX IF NOT EXISTS idx_combo_overrides_combo_id ON combo_overrides(combo_id);


