
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Upload, FileText, CheckCircle, AlertCircle, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ShopifyApiClient } from '@/utils/shopifyApi';
import { parseCsvFile } from '@/utils/csvParser';

interface TrackingRecord {
  orderNumber: string;
  trackingNumber: string;
  trackingCompany: string;
  status?: 'pending' | 'success' | 'error';
  error?: string;
}

interface TrackingUploadProps {
  shopifyConfig: {
    storeUrl: string;
    accessToken: string;
  };
}

export const TrackingUpload = ({ shopifyConfig }: TrackingUploadProps) => {
  const [file, setFile] = useState<File | null>(null);
  const [trackingRecords, setTrackingRecords] = useState<TrackingRecord[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const { toast } = useToast();

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.toLowerCase().endsWith('.csv')) {
      toast({
        title: "Lỗi file",
        description: "Vui lòng chọn file CSV.",
        variant: "destructive",
      });
      return;
    }

    setFile(selectedFile);
    
    try {
      const records = await parseCsvFile(selectedFile);
      setTrackingRecords(records.map(record => ({ ...record, status: 'pending' })));
      setUploadComplete(false);
      
      toast({
        title: "Đã tải file!",
        description: `Tìm thấy ${records.length} đơn hàng cần cập nhật tracking.`,
      });
    } catch (error) {
      toast({
        title: "Lỗi đọc file",
        description: "Không thể đọc file CSV. Vui lòng kiểm tra định dạng file.",
        variant: "destructive",
      });
    }
  };

  const processTrackingUpdates = async () => {
    if (trackingRecords.length === 0) return;

    setIsProcessing(true);
    const apiClient = new ShopifyApiClient(shopifyConfig);
    
    try {
      const updatedRecords = [...trackingRecords];
      
      for (let i = 0; i < updatedRecords.length; i++) {
        const record = updatedRecords[i];
        
        try {
          console.log(`Updating tracking for order ${record.orderNumber}...`);
          
          await apiClient.updateOrderTracking(
            record.orderNumber,
            record.trackingNumber,
            record.trackingCompany
          );
          
          updatedRecords[i] = { ...record, status: 'success' };
          
          // Cập nhật state để hiển thị progress
          setTrackingRecords([...updatedRecords]);
          
        } catch (error) {
          console.error(`Failed to update order ${record.orderNumber}:`, error);
          updatedRecords[i] = { 
            ...record, 
            status: 'error',
            error: error instanceof Error ? error.message : 'Lỗi không xác định'
          };
          setTrackingRecords([...updatedRecords]);
        }
        
        // Delay để tránh rate limiting
        if (i < updatedRecords.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      const successCount = updatedRecords.filter(r => r.status === 'success').length;
      const errorCount = updatedRecords.filter(r => r.status === 'error').length;
      
      toast({
        title: "Hoàn thành cập nhật!",
        description: `Thành công: ${successCount}, Lỗi: ${errorCount}`,
      });
      
      setUploadComplete(true);
      
    } catch (error) {
      console.error('Error processing tracking updates:', error);
      toast({
        title: "Lỗi xử lý",
        description: "Có lỗi xảy ra khi cập nhật tracking.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadTemplate = () => {
    const template = `Order Number,Tracking Number,Tracking Company
1001,1234567890,4PX
1002,0987654321,Royal Mail
1003,1122334455,USPS`;

    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'tracking_template.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return <div className="h-4 w-4 rounded-full bg-gray-300"></div>;
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Upload className="h-5 w-5" />
            <span>Upload Tracking CSV</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <FileText className="h-4 w-4" />
            <AlertDescription>
              File CSV cần có 3 cột: Order Number, Tracking Number, Tracking Company.
              <Button
                variant="link"
                className="p-0 h-auto ml-2"
                onClick={downloadTemplate}
              >
                <Download className="h-3 w-3 mr-1" />
                Tải template
              </Button>
            </AlertDescription>
          </Alert>
          
          <div className="space-y-4">
            <Input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              disabled={isProcessing}
            />
            
            {file && trackingRecords.length > 0 && (
              <div className="flex space-x-2">
                <Button
                  onClick={processTrackingUpdates}
                  disabled={isProcessing || uploadComplete}
                  className="bg-teal-500 hover:bg-teal-600"
                >
                  {isProcessing ? 'Đang xử lý...' : 'Cập nhật Tracking'}
                </Button>
                
                {uploadComplete && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setFile(null);
                      setTrackingRecords([]);
                      setUploadComplete(false);
                    }}
                  >
                    Tải file mới
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {trackingRecords.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Danh sách cập nhật</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead>Mã đơn</TableHead>
                    <TableHead>Tracking Number</TableHead>
                    <TableHead>Tracking Company</TableHead>
                    <TableHead>Lỗi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trackingRecords.map((record, index) => (
                    <TableRow key={index}>
                      <TableCell>{getStatusIcon(record.status)}</TableCell>
                      <TableCell className="font-medium">#{record.orderNumber}</TableCell>
                      <TableCell>{record.trackingNumber}</TableCell>
                      <TableCell>{record.trackingCompany}</TableCell>
                      <TableCell className="text-red-500 text-sm">
                        {record.error || ''}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
