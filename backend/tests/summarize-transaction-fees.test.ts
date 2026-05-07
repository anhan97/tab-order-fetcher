import { summarizeTransactionFees } from '../src/services/shopify.service';

describe('summarizeTransactionFees', () => {
  test('sums fees across successful sale transactions', () => {
    const txs: any[] = [
      { id: 1, kind: 'sale', status: 'success', amount: '100.00', fee: '3.20', gateway: 'shopify_payments' },
      { id: 2, kind: 'sale', status: 'success', amount: '50.00', fee: '1.75', gateway: 'shopify_payments' }
    ];
    const r = summarizeTransactionFees(txs);
    expect(r.totalFee).toBeCloseTo(4.95, 2);
    expect(r.totalNet).toBeCloseTo(145.05, 2); // (100-3.20) + (50-1.75)
    expect(r.primaryGateway).toBe('shopify_payments');
  });

  test('subtracts refund fees', () => {
    const txs: any[] = [
      { id: 1, kind: 'sale', status: 'success', amount: '100.00', fee: '3.20', gateway: 'shopify_payments' },
      { id: 2, kind: 'refund', status: 'success', amount: '40.00', fee: '1.20', gateway: 'shopify_payments' }
    ];
    const r = summarizeTransactionFees(txs);
    expect(r.totalFee).toBeCloseTo(2.00, 2); // 3.20 - 1.20
    expect(r.totalNet).toBeCloseTo(58.00, 2); // (100-3.20) - (40-1.20)
  });

  test('ignores failed/pending transactions', () => {
    const txs: any[] = [
      { id: 1, kind: 'sale', status: 'pending', amount: '100.00', fee: '3.20' },
      { id: 2, kind: 'sale', status: 'failure', amount: '100.00', fee: '3.20' },
      { id: 3, kind: 'sale', status: 'success', amount: '100.00', fee: '3.20', gateway: 'shopify_payments' }
    ];
    const r = summarizeTransactionFees(txs);
    expect(r.totalFee).toBeCloseTo(3.20, 2);
  });

  test('treats missing/empty fee as 0 (paypal/manual)', () => {
    const txs: any[] = [
      { id: 1, kind: 'sale', status: 'success', amount: '50.00', gateway: 'paypal' },
      { id: 2, kind: 'sale', status: 'success', amount: '50.00', fee: '', gateway: 'paypal' }
    ];
    const r = summarizeTransactionFees(txs);
    expect(r.totalFee).toBe(0);
    expect(r.totalNet).toBe(100);
    expect(r.primaryGateway).toBe('paypal');
  });

  test('picks gateway by frequency', () => {
    const txs: any[] = [
      { id: 1, kind: 'sale', status: 'success', amount: '50', fee: '1.5', gateway: 'paypal' },
      { id: 2, kind: 'sale', status: 'success', amount: '50', fee: '1.5', gateway: 'shopify_payments' },
      { id: 3, kind: 'sale', status: 'success', amount: '50', fee: '1.5', gateway: 'shopify_payments' }
    ];
    const r = summarizeTransactionFees(txs);
    expect(r.primaryGateway).toBe('shopify_payments');
  });

  test('returns zeros + null gateway for empty input', () => {
    const r = summarizeTransactionFees([]);
    expect(r.totalFee).toBe(0);
    expect(r.totalNet).toBe(0);
    expect(r.primaryGateway).toBeNull();
  });
});
