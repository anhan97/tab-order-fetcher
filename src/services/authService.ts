import { User, LoginRequest, RegisterRequest, VerificationRequest } from '@/types/user';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  // Configure your email service here
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

interface SafeUser {
  id: string;
  email: string;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

class AuthService {
  private users: Map<string, User> = new Map();
  private sessions: Map<string, string> = new Map(); // sessionId -> userId

  private async sendVerificationEmail(email: string, code: string) {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Verify your email',
      html: `
        <h1>Email Verification</h1>
        <p>Your verification code is: <strong>${code}</strong></p>
        <p>This code will expire in 30 minutes.</p>
      `
    };

    await transporter.sendMail(mailOptions);
  }

  private generateVerificationCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  async register(request: RegisterRequest): Promise<{ success: boolean; message: string }> {
    // Validate password match
    if (request.password !== request.confirmPassword) {
      return { success: false, message: 'Passwords do not match' };
    }

    // Check if user already exists
    const existingUser = Array.from(this.users.values()).find(u => u.email === request.email);
    if (existingUser) {
      return { success: false, message: 'Email already registered' };
    }

    // Generate verification code
    const verificationCode = this.generateVerificationCode();
    const verificationCodeExpiry = new Date();
    verificationCodeExpiry.setMinutes(verificationCodeExpiry.getMinutes() + 30);

    // Create new user
    const hashedPassword = await bcrypt.hash(request.password, 10);
    const newUser: User = {
      id: uuidv4(),
      email: request.email,
      password: hashedPassword,
      isVerified: false,
      verificationCode,
      verificationCodeExpiry,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.users.set(newUser.id, newUser);

    // Send verification email
    try {
      await this.sendVerificationEmail(request.email, verificationCode);
      return { success: true, message: 'Registration successful. Please check your email for verification code.' };
    } catch (error) {
      console.error('Failed to send verification email:', error);
      return { success: false, message: 'Failed to send verification email' };
    }
  }

  async verify(request: VerificationRequest): Promise<{ success: boolean; message: string }> {
    const user = Array.from(this.users.values()).find(u => u.email === request.email);
    
    if (!user) {
      return { success: false, message: 'User not found' };
    }

    if (user.isVerified) {
      return { success: false, message: 'Email already verified' };
    }

    if (!user.verificationCode || !user.verificationCodeExpiry) {
      return { success: false, message: 'No verification code found' };
    }

    if (new Date() > user.verificationCodeExpiry) {
      return { success: false, message: 'Verification code expired' };
    }

    if (user.verificationCode !== request.code) {
      return { success: false, message: 'Invalid verification code' };
    }

    // Update user
    user.isVerified = true;
    user.verificationCode = undefined;
    user.verificationCodeExpiry = undefined;
    user.updatedAt = new Date();
    this.users.set(user.id, user);

    return { success: true, message: 'Email verified successfully' };
  }

  async login(request: LoginRequest): Promise<{ success: boolean; message: string; sessionId?: string }> {
    const user = Array.from(this.users.values()).find(u => u.email === request.email);
    
    if (!user) {
      return { success: false, message: 'Invalid email or password' };
    }

    if (!user.isVerified) {
      return { success: false, message: 'Please verify your email first' };
    }

    const isValidPassword = await bcrypt.compare(request.password, user.password);
    if (!isValidPassword) {
      return { success: false, message: 'Invalid email or password' };
    }

    // Create session
    const sessionId = uuidv4();
    this.sessions.set(sessionId, user.id);

    return { success: true, message: 'Login successful', sessionId };
  }

  async logout(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async getCurrentUser(sessionId: string): Promise<SafeUser | null> {
    const userId = this.sessions.get(sessionId);
    if (!userId) return null;

    const user = this.users.get(userId);
    if (!user) return null;

    // Don't return sensitive information
    const { password, verificationCode, verificationCodeExpiry, ...safeUser } = user;
    return safeUser;
  }

  async resendVerificationCode(email: string): Promise<{ success: boolean; message: string }> {
    const user = Array.from(this.users.values()).find(u => u.email === email);
    
    if (!user) {
      return { success: false, message: 'User not found' };
    }

    if (user.isVerified) {
      return { success: false, message: 'Email already verified' };
    }

    // Generate new verification code
    const verificationCode = this.generateVerificationCode();
    const verificationCodeExpiry = new Date();
    verificationCodeExpiry.setMinutes(verificationCodeExpiry.getMinutes() + 30);

    // Update user
    user.verificationCode = verificationCode;
    user.verificationCodeExpiry = verificationCodeExpiry;
    user.updatedAt = new Date();
    this.users.set(user.id, user);

    // Send verification email
    try {
      await this.sendVerificationEmail(email, verificationCode);
      return { success: true, message: 'Verification code sent successfully' };
    } catch (error) {
      console.error('Failed to send verification email:', error);
      return { success: false, message: 'Failed to send verification email' };
    }
  }
}

export const authService = new AuthService(); 