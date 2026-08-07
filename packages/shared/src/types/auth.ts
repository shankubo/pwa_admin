export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  requires2fa: boolean;
  tempToken?: string;
  accessToken?: string;
}

export interface Verify2faRequest {
  tempToken: string;
  code: string;
}

export interface AuthTokens {
  accessToken: string;
}

export interface CurrentUser {
  id: number;
  username: string;
  twoFactorEnabled: boolean;
}
