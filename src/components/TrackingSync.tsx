
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Upload, Settings, Truck, CheckCircle, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ShopifyApiClient } from '@/utils/shopifyApi';

interface TrackingSyncProps {
  shopifyConfig: {
    storeUrl: string;
    accessToken: string;
  };
}

export const TrackingSync = ({ shopifyConfig }: TrackingSyncProps) => {
  const [defaultCarrier, setDefaultCarrier] = useState('Other');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [csvContent, setCsvContent] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Array<{ orderNumber: string; status: string; message: string }>>([]);
  const { toast } = useToast();

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setCsvContent(e.target?.result as string);
      };
      reader.readAsText(file);
    }
  };

  const parseCSV = (content: string) => {
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    
    // Find column indices
    const orderNumberIndex = headers.findIndex(h => 
      h.toLowerCase().includes('order') && h.toLowerCase().includes('number')
    );
    const trackingIndex = headers.findIndex(h => 
      h.toLowerCase().includes('tracking')
    );

    if (orderNumberIndex === -1 || trackingIndex === -1) {
      throw new Error('CSV phải có cột "Order Number" và "Tracking Number"');
    }

    const trackingData = lines.slice(1)
      .map(line => {
        const columns = line.split(',').map(c => c.trim());
        return {
          orderNumber: columns[orderNumberIndex]?.replace('#', ''),
          trackingNumber: columns[trackingIndex]
        };
      })
      .filter(item => item.orderNumber && item.trackingNumber);

    return trackingData;
  };

  const syncTracking = async () => {
    if (!csvContent) {
      toast({
        title: "Lỗi",
        description: "Vui lòng upload file CSV trước.",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setResults([]);

    try {
      const trackingData = parseCSV(csvContent);
      const apiClient = new ShopifyApiClient(shopifyConfig);
      const processResults: Array<{ orderNumber: string; status: string; message: string }> = [];

      for (let i = 0; i < trackingData.length; i++) {
        const { orderNumber, trackingNumber } = trackingData[i];
        
        try {
          // Get order by order number (we need to search for it)
          const orders = await apiClient.getOrders(250);
          const order = orders.find(o => o.name.replace('#', '') === orderNumber);
          
          if (!order) {
            processResults.push({
              orderNumber,
              status: 'error',
              message: 'Không tìm thấy đơn hàng'
            });
            continue;
          }

          const success = await apiClient.updateOrderTracking(
            order.id.toString(), 
            trackingNumber, 
            defaultCarrier
          );

          processResults.push({
            orderNumber,
            status: success ? 'success' : 'error',
            message: success ? 'Đã cập nhật tracking thành công' : 'Lỗi khi cập nhật tracking'
          });

        } catch (error) {
          processResults.push({
            orderNumber,
            status: 'error',
            message: error instanceof Error ? error.message : 'Lỗi không xác định'
          });
        }

        setProgress(((i + 1) / trackingData.length) * 100);
      }

      setResults(processResults);
      
      const successCount = processResults.filter(r => r.status === 'success').length;
      toast({
        title: "Hoàn thành!",
        description: `Đã xử lý ${processResults.length} đơn hàng. ${successCount} thành công.`,
      });

    } catch (error) {
      toast({
        title: "Lỗi",
        description: error instanceof Error ? error.message : "Lỗi khi xử lý file CSV",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Settings className="h-5 w-5" />
            <span>Cài đặt Tracking</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="carrier">Default Shipping Carrier</Label>
              <Input
                id="carrier"
                value={defaultCarrier}
                onChange={(e) => setDefaultCarrier(e.target.value)}
                placeholder="Other"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="trackingUrl">Tracking URL Template</Label>
              <Input
                id="trackingUrl"
                value={trackingUrl}
                onChange={(e) => setTrackingUrl(e.target.value)}
                placeholder="https://tracking.example.com/{tracking_number}"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* File Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Upload className="h-5 w-5" />
            <span>Upload File Tracking</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              File CSV cần có 2 cột: "Order Number" và "Tracking Number". 
              Chỉ những đơn hàng có tracking number sẽ được xử lý.
            </AlertDescription>
          </Alert>

          <div className="space-y-4">
            <div>
              <Label htmlFor="csvFile">Chọn file CSV</Label>
              <Input
                id="csvFile"
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                disabled={isProcessing}
              />
            </div>

            {csvContent && (
              <div className="space-y-2">
                <Label>Preview CSV Content</Label>
                <Textarea
                  value={csvContent.split('\n').slice(0, 5).join('\n')}
                  readOnly
                  className="h-32"
                />
                <p className="text-sm text-slate-500">
                  Hiển thị 5 dòng đầu tiên...
                </p>
              </div>
            )}

            <Button
              onClick={syncTracking}
              disabled={!csvContent || isProcessing}
              className="w-full bg-teal-500 hover:bg-teal-600"
            >
              {isProcessing ? (
                <>
                  <Truck className="mr-2 h-4 w-4 animate-pulse" />
                  Đang xử lý...
                </>
              ) : (
                <>
                  <Truck className="mr-2 h-4 w-4" />
                  Sync Tracking Numbers
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Progress */}
      {isProcessing && (
        <Card>
          <CardContent className="p-6">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Tiến trình xử lý</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} className="w-full" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Kết quả xử lý</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {results.map((result, index) => (
                <div
                  key={index}
                  className={`flex items-center space-x-2 p-2 rounded ${
                    result.status === 'success' 
                      ? 'bg-green-50 text-green-800' 
                      : 'bg-red-50 text-red-800'
                  }`}
                >
                  {result.status === 'success' ? (
                    <CheckCircle className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                  <span className="font-medium">#{result.orderNumber}</span>
                  <span className="text-sm">{result.message}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
