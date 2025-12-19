/**
 * Detect shipping company from tracking number based on prefixes
 */

interface ShippingCompanyWithPrefixes {
    name: string;
    tracking_prefixes?: string;
}

export function detectShippingCompany(
    trackingNumber: string,
    shippingCompanies: ShippingCompanyWithPrefixes[]
): string | null {
    if (!trackingNumber) return null;

    // Normalize tracking number (uppercase, remove spaces)
    const normalizedTracking = trackingNumber.toUpperCase().trim().replace(/\s/g, '');

    // Check each shipping company's prefixes
    for (const company of shippingCompanies) {
        if (!company.tracking_prefixes) continue;

        // Split comma-separated prefixes
        const prefixes = company.tracking_prefixes
            .split(',')
            .map(p => p.trim().toUpperCase())
            .filter(p => p.length > 0);

        // Check if tracking number starts with any of the prefixes
        for (const prefix of prefixes) {
            if (normalizedTracking.startsWith(prefix)) {
                return company.name;
            }
        }
    }

    return null;
}

/**
 * Extract tracking numbers from text (for bulk processing)
 */
export function extractTrackingNumbers(text: string): string[] {
    // Split by common delimiters (newline, comma, semicolon, tab)
    return text
        .split(/[\n,;\t]+/)
        .map(t => t.trim())
        .filter(t => t.length > 0);
}
