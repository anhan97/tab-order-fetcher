import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FacebookAdsConnection } from './FacebookAdsConnection';
import { FacebookAdsApiClient } from '@/utils/facebookAdsApi';
import { useToast } from '@/hooks/use-toast';

// Mock the useToast hook
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn()
  })
}));

// Mock the FacebookAdsApiClient
vi.mock('@/utils/facebookAdsApi', () => ({
  FacebookAdsApiClient: vi.fn(() => ({
    login: vi.fn(),
    getAdAccounts: vi.fn(),
    testConnection: vi.fn(),
    getAccessToken: vi.fn(),
    getSelectedAdAccount: vi.fn(),
  }))
}));

describe('FacebookAdsConnection', () => {
  const mockOnConnectionSuccess = vi.fn();

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
    
    // Reset localStorage before each test
    localStorage.clear();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should check for Facebook App ID in environment variables', () => {
    const originalEnv = import.meta.env.VITE_FACEBOOK_APP_ID;
    
    // Test when App ID is not configured
    delete (import.meta.env as any).VITE_FACEBOOK_APP_ID;
    
    render(<FacebookAdsConnection onConnectionSuccess={mockOnConnectionSuccess} />);
    
    const loginButton = screen.getByRole('button', { name: /connect.*facebook/i });
    fireEvent.click(loginButton);
    
    expect(screen.getByText(/facebook app id is not configured/i)).toBeInTheDocument();
    
    // Restore original env
    (import.meta.env as any).VITE_FACEBOOK_APP_ID = originalEnv;
  });

  it('should handle successful Facebook login', async () => {
    // Mock successful login response
    const mockAuthResponse = {
      accessToken: 'mock-token',
      userID: 'mock-user-id',
      expiresIn: 3600,
      data_access_expiration_time: Date.now() + 3600000
    };

    const mockAdAccounts = [
      { id: '123', name: 'Test Account 1', currency: 'USD', status: 'ACTIVE' },
      { id: '456', name: 'Test Account 2', currency: 'USD', status: 'ACTIVE' }
    ];

    // Setup mocks
    (FacebookAdsApiClient as any).mockImplementation(() => ({
      login: vi.fn().mockResolvedValue(mockAuthResponse),
      getAdAccounts: vi.fn().mockResolvedValue(mockAdAccounts),
      testConnection: vi.fn().mockResolvedValue(true),
      getAccessToken: vi.fn().mockReturnValue(mockAuthResponse.accessToken),
      getSelectedAdAccount: vi.fn().mockReturnValue(mockAdAccounts[0].id)
    }));

    render(<FacebookAdsConnection onConnectionSuccess={mockOnConnectionSuccess} />);

    // Click login button
    const loginButton = screen.getByRole('button', { name: /connect.*facebook/i });
    fireEvent.click(loginButton);

    // Wait for success state
    await waitFor(() => {
      expect(screen.getByText(/successfully.*connected/i)).toBeInTheDocument();
    });

    // Verify ad accounts are loaded
    await waitFor(() => {
      expect(screen.getByText('Test Account 1')).toBeInTheDocument();
      expect(screen.getByText('Test Account 2')).toBeInTheDocument();
    });

    // Verify onConnectionSuccess was called
    expect(mockOnConnectionSuccess).toHaveBeenCalledWith({
      accessToken: mockAuthResponse.accessToken,
      adAccountId: mockAdAccounts[0].id
    });
  });

  it('should handle Facebook login failure', async () => {
    // Mock login failure
    (FacebookAdsApiClient as any).mockImplementation(() => ({
      login: vi.fn().mockRejectedValue(new Error('Facebook login failed')),
      getAdAccounts: vi.fn(),
      testConnection: vi.fn(),
      getAccessToken: vi.fn(),
      getSelectedAdAccount: vi.fn()
    }));

    render(<FacebookAdsConnection onConnectionSuccess={mockOnConnectionSuccess} />);

    // Click login button
    const loginButton = screen.getByRole('button', { name: /connect.*facebook/i });
    fireEvent.click(loginButton);

    // Wait for error state
    await waitFor(() => {
      expect(screen.getByText(/facebook login failed/i)).toBeInTheDocument();
    });

    // Verify onConnectionSuccess was not called
    expect(mockOnConnectionSuccess).not.toHaveBeenCalled();
  });

  it('should restore existing connection from localStorage', async () => {
    // Mock localStorage data
    localStorage.setItem('facebook_access_token', 'saved-token');
    localStorage.setItem('facebook_ad_account_id', 'saved-account-id');

    const mockAdAccounts = [
      { id: 'saved-account-id', name: 'Saved Account', currency: 'USD', status: 'ACTIVE' }
    ];

    // Mock static method
    (FacebookAdsApiClient as any).fromLocalStorage = vi.fn().mockReturnValue({
      testConnection: vi.fn().mockResolvedValue(true),
      getSelectedAdAccount: vi.fn().mockReturnValue('saved-account-id'),
      getAdAccounts: vi.fn().mockResolvedValue(mockAdAccounts),
      getAccessToken: vi.fn().mockReturnValue('saved-token')
    });

    render(<FacebookAdsConnection onConnectionSuccess={mockOnConnectionSuccess} />);

    // Wait for connection to be restored
    await waitFor(() => {
      expect(mockOnConnectionSuccess).toHaveBeenCalledWith({
        accessToken: 'saved-token',
        adAccountId: 'saved-account-id'
      });
    });
  });
}); 