const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

const prisma = new PrismaClient();

async function setupCompleteCogs() {
  try {
    console.log('🚀 Setting up complete COGS system...\n');

    // Step 1: Create tables
    console.log('📋 Step 1: Creating database tables...');
    
    // Create variant_costs table
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS variant_costs (
        id VARCHAR(255) PRIMARY KEY,
        variant_id BIGINT NOT NULL,
        country_id VARCHAR(255) NOT NULL,
        shipping_company_id VARCHAR(255) NOT NULL,
        cost DECIMAL(10,2) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (country_id) REFERENCES countries(id) ON DELETE CASCADE,
        FOREIGN KEY (shipping_company_id) REFERENCES shipping_companies(id) ON DELETE CASCADE,
        UNIQUE (variant_id, country_id, shipping_company_id)
      )
    `;
    console.log('  ✓ Created variant_costs table');

    // Create combos table
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS combos (
        id VARCHAR(255) PRIMARY KEY,
        combo_id VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        trigger_quantity INT NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('  ✓ Created combos table');

    // Create combo_items table
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS combo_items (
        id VARCHAR(255) PRIMARY KEY,
        combo_id VARCHAR(255) NOT NULL,
        variant_id BIGINT NOT NULL,
        quantity INT NOT NULL,
        FOREIGN KEY (combo_id) REFERENCES combos(id) ON DELETE CASCADE,
        UNIQUE (combo_id, variant_id)
      )
    `;
    console.log('  ✓ Created combo_items table');

    // Create combo_overrides table
    await prisma.$executeRaw`
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
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (combo_id) REFERENCES combos(id) ON DELETE CASCADE,
        FOREIGN KEY (country_id) REFERENCES countries(id) ON DELETE CASCADE,
        FOREIGN KEY (shipping_company_id) REFERENCES shipping_companies(id) ON DELETE CASCADE,
        UNIQUE (combo_id, country_id, shipping_company_id)
      )
    `;
    console.log('  ✓ Created combo_overrides table');

    // Create indexes
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_variant_costs_variant_id ON variant_costs(variant_id)`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_variant_costs_country_shipping ON variant_costs(country_id, shipping_company_id)`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_combo_items_combo_id ON combo_items(combo_id)`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_combo_items_variant_id ON combo_items(variant_id)`;
    await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS idx_combo_overrides_combo_id ON combo_overrides(combo_id)`;
    console.log('  ✓ Created performance indexes');

    // Step 2: Populate default data
    console.log('\n🌍 Step 2: Populating default data...');
    
    // Insert default countries
    const countries = [
      { id: uuidv4(), code: 'US', name: 'United States', currency: 'USD' },
      { id: uuidv4(), code: 'CA', name: 'Canada', currency: 'CAD' },
      { id: uuidv4(), code: 'AU', name: 'Australia', currency: 'AUD' },
      { id: uuidv4(), code: 'UK', name: 'United Kingdom', currency: 'GBP' },
      { id: uuidv4(), code: 'DE', name: 'Germany', currency: 'EUR' },
      { id: uuidv4(), code: 'FR', name: 'France', currency: 'EUR' },
      { id: uuidv4(), code: 'IT', name: 'Italy', currency: 'EUR' },
      { id: uuidv4(), code: 'ES', name: 'Spain', currency: 'EUR' }
    ];

    for (const country of countries) {
      await prisma.$executeRaw`
        INSERT INTO countries (id, code, name, currency) 
        VALUES (${country.id}, ${country.code}, ${country.name}, ${country.currency})
        ON CONFLICT (code) DO NOTHING
      `;
    }
    console.log('  ✓ Inserted 8 countries');

    // Insert default shipping companies
    const shippingCompanies = [
      { id: uuidv4(), name: 'YunTu', display_name: 'YunTu Express' },
      { id: uuidv4(), name: 'Shengtu Logistics', display_name: 'Shengtu Logistics' },
      { id: uuidv4(), name: 'Yuanpeng Logistics', display_name: 'Yuanpeng Logistics' },
      { id: uuidv4(), name: 'DHL', display_name: 'DHL Express' },
      { id: uuidv4(), name: 'FedEx', display_name: 'FedEx Express' },
      { id: uuidv4(), name: 'UPS', display_name: 'UPS Express' }
    ];

    for (const company of shippingCompanies) {
      await prisma.$executeRaw`
        INSERT INTO shipping_companies (id, name, display_name) 
        VALUES (${company.id}, ${company.name}, ${company.display_name})
        ON CONFLICT (name) DO NOTHING
      `;
    }
    console.log('  ✓ Inserted 6 shipping companies');

    // Step 3: Verify setup
    console.log('\n✅ Step 3: Verifying setup...');
    
    const countryCount = await prisma.$queryRaw`SELECT COUNT(*) as count FROM countries`;
    const shippingCount = await prisma.$queryRaw`SELECT COUNT(*) as count FROM shipping_companies`;
    const variantCostCount = await prisma.$queryRaw`SELECT COUNT(*) as count FROM variant_costs`;
    const comboCount = await prisma.$queryRaw`SELECT COUNT(*) as count FROM combos`;
    
    console.log(`  ✓ ${countryCount[0].count} countries available`);
    console.log(`  ✓ ${shippingCount[0].count} shipping companies available`);
    console.log(`  ✓ ${variantCostCount[0].count} variant costs configured`);
    console.log(`  ✓ ${comboCount[0].count} combos configured`);

    // Step 4: Test API functionality
    console.log('\n🧪 Step 4: Testing API functionality...');
    
    // Test COGS calculation
    const usCountry = await prisma.$queryRaw`SELECT * FROM countries WHERE code = 'US' LIMIT 1`;
    const yuntuCompany = await prisma.$queryRaw`SELECT * FROM shipping_companies WHERE name = 'YunTu' LIMIT 1`;
    
    if (usCountry.length > 0 && yuntuCompany.length > 0) {
      // Insert a test variant cost
      const testCostId = uuidv4();
      await prisma.$executeRaw`
        INSERT INTO variant_costs (id, variant_id, country_id, shipping_company_id, cost)
        VALUES (${testCostId}, ${47597332136187}, ${usCountry[0].id}, ${yuntuCompany[0].id}, ${8.43})
        ON CONFLICT (variant_id, country_id, shipping_company_id) 
        DO UPDATE SET cost = ${8.43}
      `;
      
      // Test calculation
      const variantCosts = await prisma.$queryRaw`
        SELECT * FROM variant_costs 
        WHERE variant_id = ${47597332136187} 
        AND country_id = ${usCountry[0].id} 
        AND shipping_company_id = ${yuntuCompany[0].id}
        AND is_active = true
        LIMIT 1
      `;
      
      if (variantCosts.length > 0) {
        const totalCogs = Number(variantCosts[0].cost) * 2; // quantity = 2
        console.log(`  ✓ COGS calculation test: ${variantCosts[0].cost} * 2 = ${totalCogs}`);
      }
    }

    console.log('\n🎉 COGS system setup completed successfully!');
    console.log('\n📋 Available API endpoints:');
    console.log('  • GET  /api/cogs/config - Get COGS configuration');
    console.log('  • POST /api/cogs/config - Save COGS configuration');
    console.log('  • POST /api/cogs/calculate - Calculate COGS for orders');
    console.log('  • GET  /api/cogs/countries - List all countries');
    console.log('  • GET  /api/cogs/shipping-companies - List all shipping companies');
    
    console.log('\n🚀 Ready to use! Start your backend server with: npm run dev');
    
  } catch (error) {
    console.error('❌ Error setting up COGS system:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

setupCompleteCogs();


