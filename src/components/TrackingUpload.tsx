
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Upload, FileText, CheckCircle, AlertCircle, Download, Zap, Bell } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/utils/apiClient';
import { ShopifyApiClient } from '@/utils/shopifyApi';
import { parseCsvFile } from '@/utils/csvParser';
import { detectShippingCompany } from '@/utils/trackingUtils';

interface TrackingRecord {
  orderNumber: string;
  trackingNumber: string;
  trackingCompany: string;
  trackingUrl?: string;
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
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0 });
  const [useBatchMode, setUseBatchMode] = useState(true);
  const [notifyCustomer, setNotifyCustomer] = useState(true);
  const [shippingCompanies, setShippingCompanies] = useState<Array<{ name: string; tracking_prefixes?: string }>>([]);
  const { toast } = useToast();

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.toLowerCase().endsWith('.csv')) {
      toast({
        title: "Invalid file",
        description: "Please choose a CSV file.",
        variant: "destructive",
      });
      return;
    }

    setFile(selectedFile);

    try {
      // Load shipping companies for auto-detection
      await loadShippingCompanies();

      const records = await parseCsvFile(selectedFile);

      // Auto-detect shipping company if not provided
      const recordsWithDetection = records.map(record => {
        if (!record.trackingCompany || record.trackingCompany.trim() === '') {
          const detected = detectShippingCompany(record.trackingNumber, shippingCompanies);
          if (detected) {
            return { ...record, trackingCompany: detected, status: 'pending' as const };
          }
        }
        return { ...record, status: 'pending' as const };
      });

      setTrackingRecords(recordsWithDetection);
      setUploadComplete(false);

      const autoDetectedCount = recordsWithDetection.filter(
        (r, i) => r.trackingCompany !== records[i].trackingCompany
      ).length;

      toast({
        title: "File loaded",
        description: `Found ${records.length} orders. ${autoDetectedCount > 0 ? `Auto-detected ${autoDetectedCount} shipping companies.` : ''}`,
      });
    } catch (error) {
      toast({
        title: "Could not read file",
        description: "Could not read the CSV. Please check the file format.",
        variant: "destructive",
      });
    }
  };

  const processTrackingUpdates = async () => {
    if (trackingRecords.length === 0) return;

    setIsProcessing(true);
    setProcessingProgress({ current: 0, total: trackingRecords.length });
    const apiClient = new ShopifyApiClient(shopifyConfig);

    try {
      const updatedRecords = [...trackingRecords];

      if (useBatchMode && trackingRecords.length > 1) {
        // Use batch API for faster processing
        console.log(`Processing ${trackingRecords.length} orders using batch API`);

        const trackingUpdates = trackingRecords.map(record => ({
          orderNumber: record.orderNumber,
          trackingNumber: record.trackingNumber,
          trackingCompany: record.trackingCompany,
          trackingUrl: record.trackingUrl
        }));

        const result = await apiClient.batchUpdateOrderTracking(trackingUpdates, notifyCustomer);

        console.log('Batch update result:', result);

        // Update records based on batch results
        trackingRecords.forEach((record, index) => {
          const successful = result.successful.find(s => s.orderNumber === record.orderNumber);
          const failed = result.failed.find(f => f.orderNumber === record.orderNumber);

          if (successful) {
            updatedRecords[index] = { ...record, status: 'success' };
          } else if (failed) {
            updatedRecords[index] = {
              ...record,
              status: 'error',
              error: failed.error
            };
          }
        });

        setProcessingProgress({ current: trackingRecords.length, total: trackingRecords.length });
        setTrackingRecords([...updatedRecords]);

        toast({
          title: "Update complete",
          description: `Succeeded: ${result.summary.successful}, failed: ${result.summary.failed}`,
        });

      } else {
        // Process orders one by one to prevent API rate limiting
        console.log(`Processing ${updatedRecords.length} orders one by one`);

        for (let index = 0; index < updatedRecords.length; index++) {
          const record = updatedRecords[index];
          console.log(`Processing order ${index + 1}/${updatedRecords.length}: ${record.orderNumber}`);

          try {
            console.log(`Updating tracking for order ${record.orderNumber}...`, {
              orderNumber: record.orderNumber,
              trackingNumber: record.trackingNumber,
              trackingCompany: record.trackingCompany,
              trackingUrl: record.trackingUrl
            });

            const result = await apiClient.updateOrderTracking(
              record.orderNumber,
              record.trackingNumber,
              record.trackingCompany,
              record.trackingUrl,
              notifyCustomer
            );

            console.log(`Tracking update result for order ${record.orderNumber}:`, result);

            updatedRecords[index] = { ...record, status: 'success' as const };

          } catch (error) {
            console.error(`Failed to update order ${record.orderNumber}:`, error);
            updatedRecords[index] = {
              ...record,
              status: 'error' as const,
              error: error instanceof Error ? error.message : 'Unknown error'
            };
          }

          // Update progress after each order
          setProcessingProgress({ current: index + 1, total: updatedRecords.length });

          // Update state to show progress
          setTrackingRecords([...updatedRecords]);

          // Delay 1 second between each order to avoid rate limiting
          if (index < updatedRecords.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }

        const successCount = updatedRecords.filter(r => r.status === 'success').length;
        const errorCount = updatedRecords.filter(r => r.status === 'error').length;

        toast({
          title: "Update complete",
          description: `Succeeded: ${successCount}, failed: ${errorCount}`,
        });
      }

      setUploadComplete(true);

    } catch (error) {
      console.error('Error processing tracking updates:', error);
      toast({
        title: "Processing error",
        description: "Something went wrong while updating tracking.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const loadShippingCompanies = async () => {
    try {
      const apiBaseUrl = '/api';
      setShippingCompanies(await apiFetch<any[]>(`${apiBaseUrl}/cogs/shipping-companies`));
    } catch (error) {
      console.warn('Error loading shipping companies:', error);
    }
  };

  const downloadTemplate = () => {
    const template = `Order Number,Tracking Number,Tracking Company,Tracking URL
1001,1234567890,4PX,https://track.4px.com/1234567890
1002,0987654321,Royal Mail,https://www.royalmail.com/track-your-item#/tracking-results/0987654321
1003,1122334455,USPS,https://tools.usps.com/go/TrackConfirmAction?tLabels=1122334455`;

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
              The CSV needs these columns: Order Number, Tracking Number, Tracking Company.
              Optional: Tracking URL, to attach a custom tracking link.
              <Button
                variant="link"
                className="p-0 h-auto ml-2"
                onClick={downloadTemplate}
              >
                <Download className="h-3 w-3 mr-1" />
                Download template
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
              <div className="space-y-4">
                <div className="flex flex-col space-y-3">
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="batch-mode"
                        checked={useBatchMode}
                        onCheckedChange={setUseBatchMode}
                        disabled={isProcessing}
                      />
                      <Label htmlFor="batch-mode" className="flex items-center space-x-1">
                        <Zap className="h-4 w-4 text-yellow-500" />
                        <span>Batch Mode (Faster)</span>
                      </Label>
                    </div>
                    <div className="text-sm text-slate-600">
                      {useBatchMode ? 'All orders processed simultaneously' : 'Orders processed in small batches'}
                    </div>
                  </div>

                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="notify-customer"
                        checked={notifyCustomer}
                        onCheckedChange={setNotifyCustomer}
                        disabled={isProcessing}
                      />
                      <Label htmlFor="notify-customer" className="flex items-center space-x-1">
                        <Bell className="h-4 w-4 text-blue-500" />
                        <span>Notify the customer</span>
                      </Label>
                    </div>
                    <div className="text-sm text-slate-600">
                      {notifyCustomer ? 'Shopify will email tracking to the customer' : 'No notification email will be sent'}
                    </div>
                  </div>
                </div>

                <div className="flex space-x-2">
                  <Button
                    onClick={processTrackingUpdates}
                    disabled={isProcessing || uploadComplete}
                    className="bg-teal-500 hover:bg-teal-600"
                  >
                    {isProcessing ? `Processing… (${processingProgress.current}/${processingProgress.total})` : 'Update tracking'}
                  </Button>

                  {uploadComplete && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setFile(null);
                        setTrackingRecords([]);
                        setUploadComplete(false);
                        setProcessingProgress({ current: 0, total: 0 });
                      }}
                    >
                      Upload a new file
                    </Button>
                  )}
                </div>

                {isProcessing && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm text-slate-600">
                      <span>Progress</span>
                      <span>{processingProgress.current}/{processingProgress.total}</span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-2">
                      <div
                        className="bg-teal-500 h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${processingProgress.total > 0 ? (processingProgress.current / processingProgress.total) * 100 : 0}%`
                        }}
                      ></div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {trackingRecords.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Rows to update</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Order no.</TableHead>
                    <TableHead>Tracking Number</TableHead>
                    <TableHead>Tracking Company</TableHead>
                    <TableHead>Tracking URL</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {trackingRecords.map((record, index) => (
                    <TableRow key={index}>
                      <TableCell>{getStatusIcon(record.status)}</TableCell>
                      <TableCell className="font-medium">#{record.orderNumber}</TableCell>
                      <TableCell>{record.trackingNumber}</TableCell>
                      <TableCell>{record.trackingCompany}</TableCell>
                      <TableCell className="max-w-xs truncate">
                        {record.trackingUrl && (
                          <a
                            href={record.trackingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:underline text-sm"
                          >
                            {record.trackingUrl}
                          </a>
                        )}
                      </TableCell>
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
