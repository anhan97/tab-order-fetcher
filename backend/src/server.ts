import express from 'express';
import cors from 'cors';
import shopifyRoutes from './routes/shopify.routes';
import facebookRoutes from './routes/facebook.routes';
import cogsRoutes from './routes/cogs';

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/shopify', shopifyRoutes);
app.use('/api/facebook', facebookRoutes);
app.use('/api/cogs', cogsRoutes);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
}); 