// Removed: legacy account-level FB ad-spend sync. The FacebookAdSpend +
// FacebookAdAccount tables were dropped in the basecost-redesign migration.
//
// Per-store ad spend is now resolved through CampaignStoreMapping, reading
// either the live 5min cache (today) or FacebookAdInsightSnapshot (past
// days). See backend/src/services/campaign-mapping.service.ts.
export {};
