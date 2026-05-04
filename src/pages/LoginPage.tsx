import { useState } from 'react';
import { Link, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/AuthContext';
import { ShoppingBag, Loader2 } from 'lucide-react';

export const LoginPage = () => {
  const { user, login, loading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }
  if (user) {
    // Already logged in — go where they were trying to reach, or default home.
    const target = (location.state as any)?.from?.pathname || '/orders';
    return <Navigate to={target} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || submitting) return;
    setSubmitting(true);
    try {
      await login(email, password);
      const target = (location.state as any)?.from?.pathname || '/orders';
      navigate(target, { replace: true });
    } catch (err: any) {
      toast({ title: 'Login failed', description: err?.message || 'Check email + password', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-teal-50/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto p-3 bg-gradient-to-br from-teal-500 to-emerald-600 rounded-2xl w-14 h-14 flex items-center justify-center shadow-md shadow-teal-500/30">
            <ShoppingBag className="h-7 w-7 text-white" />
          </div>
          <div>
            <CardTitle className="text-2xl">Sign in to Order Manager</CardTitle>
            <CardDescription className="mt-1">Manage all your Shopify stores from one place.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Sign in
            </Button>
            <p className="text-center text-sm text-slate-600">
              Don't have an account? <Link to="/register" className="text-teal-600 hover:underline font-medium">Create one</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
