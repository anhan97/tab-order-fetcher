import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import {
  validateRegistration,
  validateLogin
} from '../middleware/validation.middleware';

const router = Router();
const authController = new AuthController();

// Register new user
router.post('/register', validateRegistration, (req, res) => authController.register(req, res));

// Login
router.post('/login', validateLogin, (req, res) => authController.login(req, res));

// Verify email
router.get('/verify/:token', (req, res) => authController.verifyEmail(req, res));

export default router; 