export interface User {
  id: string;
  email: string;
  password: string; // Hashed
  isVerified: boolean;
  verificationCode?: string;
  verificationCodeExpiry?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Store {
  id: string;
  userId: string;
  name: string;
  shopifyConfig: {
    storeUrl: string;
    accessToken: string;
  };
  facebookConfigs: {
    id: string;
    accessToken: string;
    adAccountId: string;
    name: string;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

export interface VerificationRequest {
  email: string;
  code: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  confirmPassword: string;
}

export interface StoreCreateRequest {
  name: string;
  shopifyConfig: {
    storeUrl: string;
    accessToken: string;
  };
} 