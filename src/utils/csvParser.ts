
interface TrackingRecord {
  orderNumber: string;
  trackingNumber: string;
  trackingCompany: string;
  trackingUrl?: string;
}

export const parseCsvFile = (file: File): Promise<TrackingRecord[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (event) => {
      try {
        const csv = event.target?.result as string;
        const lines = csv.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) {
          throw new Error('File CSV phải có ít nhất 2 dòng (header + data)');
        }
        
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        
        // Check required columns
        const requiredColumns = ['order number', 'tracking number', 'tracking company'];
        const missingColumns = requiredColumns.filter(col => 
          !headers.some(h => h.includes(col.replace(' ', '')) || h.includes(col))
        );
        
        if (missingColumns.length > 0) {
          throw new Error(`Thiếu các cột: ${missingColumns.join(', ')}`);
        }
        
        // Find column indexes
        const orderNumberIndex = headers.findIndex(h => 
          h.includes('order') && h.includes('number') || h === 'order number'
        );
        const trackingNumberIndex = headers.findIndex(h => 
          h.includes('tracking') && h.includes('number') || h === 'tracking number'
        );
        const trackingCompanyIndex = headers.findIndex(h => 
          h.includes('tracking') && h.includes('company') || h === 'tracking company'
        );
        const trackingUrlIndex = headers.findIndex(h => 
          h.includes('tracking') && h.includes('url') || h === 'tracking url' || h === 'tracking link'
        );
        
        const records: TrackingRecord[] = [];
        
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
          
          if (values.length < 3) continue; // Skip rows without enough data
          
          const record: TrackingRecord = {
            orderNumber: values[orderNumberIndex] || '',
            trackingNumber: values[trackingNumberIndex] || '',
            trackingCompany: values[trackingCompanyIndex] || '',
          };
          
          // Add tracking URL if available
          if (trackingUrlIndex !== -1 && values[trackingUrlIndex]) {
            record.trackingUrl = values[trackingUrlIndex];
          }
          
          // Remove # if present in order number
          record.orderNumber = record.orderNumber.replace('#', '');
          
          if (record.orderNumber && record.trackingNumber && record.trackingCompany) {
            records.push(record);
          }
        }
        
        if (records.length === 0) {
          throw new Error('Không tìm thấy dữ liệu hợp lệ trong file CSV');
        }
        
        resolve(records);
        
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Không thể đọc file'));
    };
    
    reader.readAsText(file, 'utf-8');
  });
};
