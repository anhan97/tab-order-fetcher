import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Clock, ShieldX, LogOut, RefreshCw } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useNavigate } from 'react-router-dom';

/**
 * Landing screen for PENDING (chờ admin duyệt) and SUSPENDED accounts.
 * They can log in — every feature route is blocked server-side by
 * requireActive — so this page is all they see until an admin acts.
 */
export const PendingApprovalPage = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const suspended = user?.status === 'SUSPENDED';

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <Card className="max-w-md w-full p-10 text-center">
        <div className={`p-5 rounded-2xl w-20 h-20 mx-auto flex items-center justify-center shadow-lg mb-6 ${
          suspended
            ? 'bg-gradient-to-br from-rose-500 to-red-600 shadow-rose-500/30'
            : 'bg-gradient-to-br from-amber-400 to-orange-500 shadow-amber-500/30'
        }`}>
          {suspended
            ? <ShieldX className="h-10 w-10 text-white" />
            : <Clock className="h-10 w-10 text-white" />}
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-2">
          {suspended ? 'Tài khoản đã bị khoá' : 'Đang chờ admin duyệt'}
        </h2>
        <p className="text-slate-600 mb-6">
          {suspended ? (
            <>Tài khoản <strong>{user?.email}</strong> đã bị tạm khoá. Liên hệ admin để được mở lại.</>
          ) : (
            <>Tài khoản <strong>{user?.email}</strong> đã đăng ký thành công và đang chờ admin
            phê duyệt. Sau khi được duyệt, đăng nhập lại (hoặc bấm kiểm tra) là vào được hệ thống.</>
          )}
        </p>
        <div className="flex gap-3 justify-center">
          {!suspended && (
            <Button variant="outline" onClick={() => window.location.reload()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Kiểm tra lại
            </Button>
          )}
          <Button variant="outline" onClick={handleLogout} className="text-rose-600 border-rose-200 hover:bg-rose-50">
            <LogOut className="h-4 w-4 mr-2" />
            Đăng xuất
          </Button>
        </div>
      </Card>
    </div>
  );
};
