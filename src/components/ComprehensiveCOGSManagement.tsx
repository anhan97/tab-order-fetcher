import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Edit, Trash2, Package, Globe, Truck, DollarSign, Calculator, Upload, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { 
  PricebookImportConfig, 
  QuoteRequest, 
  CostCalculationResult,
  CreatePricebookRequest,
  CreateComboRequest
} from '@/types/cogs';
import { 
  yunTuUSConfig, 
  shengtuUSConfig, 
  yuanpengUSConfig,
  seedAllPricebooks 
} from '@/utils/samplePricebookData';

interface ComprehensiveCOGSManagementProps {
  onUpdateCOGS?: (configs: any[]) => void;
}

const COUNTRIES = [
  'US', 'UK', 'CA', 'AU', 'DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'NO', 'DK', 'FI',
  'JP', 'KR', 'SG', 'HK', 'TW', 'MY', 'TH', 'PH', 'ID', 'VN', 'IN', 'BR', 'MX'
];

const SUPPLIERS = [
  'YunTu',
  'Shengtu Logistics', 
  'Yuanpeng Logistics',
  'DHL',
  'FedEx',
  'UPS',
  'Custom'
];

const CURRENCIES = ['USD', 'GBP', 'CAD', 'EUR', 'AUD', 'JPY'];

export const ComprehensiveCOGSManagement: React.FC<ComprehensiveCOGSManagementProps> = ({ onUpdateCOGS }) => {
  const [pricebooks, setPricebooks] = useState<any[]>([]);
  const [combos, setCombos] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddPricebookDialog, setShowAddPricebookDialog] = useState(false);
  const [showAddComboDialog, setShowAddComboDialog] = useState(false);
  const [showCalculatorDialog, setShowCalculatorDialog] = useState(false);
  const [selectedPricebook, setSelectedPricebook] = useState<any>(null);
  const { toast } = useToast();

  // Form states
  const [newPricebook, setNewPricebook] = useState<CreatePricebookRequest>({
    country_code: '',
    shipping_company: '',
    currency: 'USD'
  });

  const [newCombo, setNewCombo] = useState<CreateComboRequest>({
    name: '',
    items: []
  });

  const [calculatorRequest, setCalculatorRequest] = useState<QuoteRequest>({
    country_code: '',
    shipping_company: '',
    currency: 'USD',
    lines: []
  });

  const [calculatorResult, setCalculatorResult] = useState<CostCalculationResult | null>(null);

  useEffect(() => {
    loadPricebooks();
    loadCombos();
    loadProducts();
  }, []);

  const loadPricebooks = async () => {
    try {
      setIsLoading(true);
      // Use localhost API when running on ngrok
      const apiBaseUrl = window.location.origin.includes('ngrok') 
        ? 'http://localhost:3001/api'
        : '/api';
      
      const response = await fetch(`${apiBaseUrl}/comprehensive-cogs/pricebooks`, {
        headers: {
          'X-User-Id': 'default-user',
          'X-Store-Id': 'default-store'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setPricebooks(data);
      }
    } catch (error) {
      console.error('Error loading pricebooks:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadCombos = async () => {
    try {
      // This would load combos from the API
      setCombos([]);
    } catch (error) {
      console.error('Error loading combos:', error);
    }
  };

  const loadProducts = async () => {
    try {
      const storeUrl = localStorage.getItem('shopify_store_url');
      const accessToken = localStorage.getItem('shopify_access_token');
      
      if (!storeUrl || !accessToken) {
        console.log('Shopify not connected, skipping product fetch');
        setProducts([]);
        return;
      }

      console.log('Loading products via backend proxy...', { storeUrl, hasToken: !!accessToken });

      // Use localhost API when running on ngrok
      const apiBaseUrl = window.location.origin.includes('ngrok') 
        ? 'http://localhost:3001/api'
        : '/api';
      
      const response = await fetch(`${apiBaseUrl}/shopify/products?status=active&limit=50`, {
        headers: {
          'X-Shopify-Store-Domain': storeUrl,
          'X-Shopify-Access-Token': accessToken,
        },
      });

      console.log('Response status:', response.status, response.statusText);
      console.log('Response headers:', Object.fromEntries(response.headers.entries()));
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to fetch products:', response.status, errorText);
        throw new Error(`Failed to fetch products: ${response.status} ${errorText}`);
      }
      
      const responseText = await response.text();
      console.log('Raw response:', responseText.substring(0, 200) + '...');
      
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Failed to parse JSON response:', parseError);
        console.error('Response was:', responseText);
        throw new Error('Invalid JSON response from server');
      }
      
      console.log('Products loaded:', data.products?.length || 0, 'products');
      setProducts(data.products || []);
    } catch (error) {
      console.error('Error fetching products:', error);
      setProducts([]);
    }
  };

  const handleCreatePricebook = async () => {
    try {
      setIsLoading(true);
      // Use localhost API when running on ngrok
      const apiBaseUrl = window.location.origin.includes('ngrok') 
        ? 'http://localhost:3001/api'
        : '/api';
      
      const response = await fetch(`${apiBaseUrl}/comprehensive-cogs/pricebooks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'default-user',
          'X-Store-Id': 'default-store'
        },
        body: JSON.stringify(newPricebook)
      });

      if (response.ok) {
        await loadPricebooks();
        setShowAddPricebookDialog(false);
        setNewPricebook({ country_code: '', shipping_company: '', currency: 'USD' });
        toast({
          title: "Success",
          description: "Pricebook created successfully",
        });
      } else {
        throw new Error('Failed to create pricebook');
      }
    } catch (error) {
      console.error('Error creating pricebook:', error);
      toast({
        title: "Error",
        description: "Failed to create pricebook",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateCombo = async () => {
    try {
      setIsLoading(true);
      // Use localhost API when running on ngrok
      const apiBaseUrl = window.location.origin.includes('ngrok') 
        ? 'http://localhost:3001/api'
        : '/api';
      
      const response = await fetch(`${apiBaseUrl}/comprehensive-cogs/combos`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'default-user',
          'X-Store-Id': 'default-store'
        },
        body: JSON.stringify(newCombo)
      });

      if (response.ok) {
        await loadCombos();
        setShowAddComboDialog(false);
        setNewCombo({ name: '', items: [] });
        toast({
          title: "Success",
          description: "Combo created successfully",
        });
      } else {
        throw new Error('Failed to create combo');
      }
    } catch (error) {
      console.error('Error creating combo:', error);
      toast({
        title: "Error",
        description: "Failed to create combo",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCalculateCost = async () => {
    try {
      setIsLoading(true);
      // Use localhost API when running on ngrok
      const apiBaseUrl = window.location.origin.includes('ngrok') 
        ? 'http://localhost:3001/api'
        : '/api';
      
      const response = await fetch(`${apiBaseUrl}/comprehensive-cogs/cost/quote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'default-user'
        },
        body: JSON.stringify(calculatorRequest)
      });

      if (response.ok) {
        const result = await response.json();
        setCalculatorResult(result);
        toast({
          title: "Success",
          description: "Cost calculated successfully",
        });
      } else {
        throw new Error('Failed to calculate cost');
      }
    } catch (error) {
      console.error('Error calculating cost:', error);
      toast({
        title: "Error",
        description: "Failed to calculate cost",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSeedSampleData = async () => {
    try {
      setIsLoading(true);
      
      const configs = [yunTuUSConfig, shengtuUSConfig, yuanpengUSConfig];
      
      for (const config of configs) {
        // Use localhost API when running on ngrok
        const apiBaseUrl = window.location.origin.includes('ngrok') 
          ? 'http://localhost:3001/api'
          : '/api';
        
        const response = await fetch(`${apiBaseUrl}/comprehensive-cogs/pricebooks/import`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': 'default-user',
            'X-Store-Id': 'default-store'
          },
          body: JSON.stringify(config)
        });

        if (!response.ok) {
          console.warn(`Failed to import ${config.country_code} - ${config.shipping_company}`);
        }
      }

      await loadPricebooks();
      toast({
        title: "Success",
        description: "Sample data imported successfully",
      });
    } catch (error) {
      console.error('Error seeding sample data:', error);
      toast({
        title: "Error",
        description: "Failed to import sample data",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const addLineItem = () => {
    setCalculatorRequest(prev => ({
      ...prev,
      lines: [...(prev.lines || []), { variant_id: 0, qty: 1 }]
    }));
  };

  const updateLineItem = (index: number, field: 'variant_id' | 'qty', value: number) => {
    setCalculatorRequest(prev => ({
      ...prev,
      lines: prev.lines?.map((line, i) => 
        i === index ? { ...line, [field]: value } : line
      ) || []
    }));
  };

  const removeLineItem = (index: number) => {
    setCalculatorRequest(prev => ({
      ...prev,
      lines: prev.lines?.filter((_, i) => i !== index) || []
    }));
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Comprehensive COGS Management</h2>
          <p className="text-slate-600">
            Advanced pricing system with tiered shipping, cost overrides, and combo support
          </p>
          <div className="text-sm text-gray-500 mt-1">
            Products loaded: {products.length} | 
            Shopify: {localStorage.getItem('shopify_store_url') ? 'Connected' : 'Not connected'}
          </div>
        </div>
        <div className="flex space-x-2">
          <Button onClick={loadProducts} disabled={isLoading} variant="outline">
            <Package className="h-4 w-4 mr-2" />
            {isLoading ? 'Loading...' : 'Load Products'}
          </Button>
          <Button onClick={handleSeedSampleData} disabled={isLoading}>
            <Upload className="h-4 w-4 mr-2" />
            Import Sample Data
          </Button>
        </div>
      </div>

      <Tabs defaultValue="pricebooks" className="w-full">
        <TabsList>
          <TabsTrigger value="pricebooks">Pricebooks</TabsTrigger>
          <TabsTrigger value="combos">Combos</TabsTrigger>
          <TabsTrigger value="calculator">Cost Calculator</TabsTrigger>
        </TabsList>

        <TabsContent value="pricebooks" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Pricebooks</h3>
            <Dialog open={showAddPricebookDialog} onOpenChange={setShowAddPricebookDialog}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Pricebook
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Pricebook</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="country">Country</Label>
                      <Select 
                        value={newPricebook.country_code}
                        onValueChange={(value) => setNewPricebook(prev => ({ ...prev, country_code: value }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select country" />
                        </SelectTrigger>
                        <SelectContent>
                          {COUNTRIES.map(country => (
                            <SelectItem key={country} value={country}>
                              {country}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="supplier">Shipping Company</Label>
                      <Select 
                        value={newPricebook.shipping_company}
                        onValueChange={(value) => setNewPricebook(prev => ({ ...prev, shipping_company: value }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select supplier" />
                        </SelectTrigger>
                        <SelectContent>
                          {SUPPLIERS.map(supplier => (
                            <SelectItem key={supplier} value={supplier}>
                              {supplier}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="currency">Currency</Label>
                    <Select 
                      value={newPricebook.currency}
                      onValueChange={(value) => setNewPricebook(prev => ({ ...prev, currency: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select currency" />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map(currency => (
                          <SelectItem key={currency} value={currency}>
                            {currency}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex justify-end space-x-2">
                    <Button variant="outline" onClick={() => setShowAddPricebookDialog(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleCreatePricebook} disabled={isLoading}>
                      {isLoading ? 'Creating...' : 'Create Pricebook'}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Country</TableHead>
                <TableHead>Shipping Company</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Shipping Tiers</TableHead>
                <TableHead>Variant Overrides</TableHead>
                <TableHead>Combo Overrides</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pricebooks.map((pricebook) => (
                <TableRow key={pricebook.pricebook_id}>
                  <TableCell className="flex items-center space-x-1">
                    <Globe className="h-4 w-4" />
                    <span>{pricebook.country_code}</span>
                  </TableCell>
                  <TableCell className="flex items-center space-x-1">
                    <Truck className="h-4 w-4" />
                    <span>{pricebook.shipping_company}</span>
                  </TableCell>
                  <TableCell>{pricebook.currency}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {pricebook.tiers?.length || 0} tiers
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {Object.keys(pricebook.variant_overrides || {}).length} overrides
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {Object.keys(pricebook.combo_overrides || {}).length} overrides
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedPricebook(pricebook)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="combos" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Product Combos</h3>
            <Dialog open={showAddComboDialog} onOpenChange={setShowAddComboDialog}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Combo
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Combo</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="comboName">Combo Name</Label>
                    <Input
                      id="comboName"
                      value={newCombo.name}
                      onChange={(e) => setNewCombo(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g., Lunch Bag Combo 2"
                    />
                  </div>
                  
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <Label>Combo Items</Label>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={loadProducts}
                        disabled={isLoading}
                      >
                        {isLoading ? 'Loading...' : 'Refresh Products'}
                      </Button>
                    </div>
                    {products.length === 0 && (
                      <div className="text-sm text-amber-600 bg-amber-50 p-2 rounded mb-2">
                        No products loaded. Make sure Shopify is connected and click "Refresh Products".
                      </div>
                    )}
                    <div className="space-y-2">
                      {newCombo.items.map((item, index) => (
                        <div key={index} className="flex space-x-2">
                          <Select
                            value={item.variant_id.toString()}
                            onValueChange={(value) => {
                              const updatedItems = [...newCombo.items];
                              updatedItems[index] = { ...item, variant_id: parseInt(value) };
                              setNewCombo(prev => ({ ...prev, items: updatedItems }));
                            }}
                          >
                            <SelectTrigger className="flex-1">
                              <SelectValue placeholder={products.length === 0 ? "No products available" : "Select product variant"} />
                            </SelectTrigger>
                            <SelectContent>
                              {products.length === 0 ? (
                                <SelectItem value="0" disabled>No products available</SelectItem>
                              ) : (
                                products.map(product => 
                                  product.variants.map(variant => (
                                    <SelectItem key={variant.id} value={variant.id.toString()}>
                                      {product.title} - {variant.title}
                                    </SelectItem>
                                  ))
                                )
                              )}
                            </SelectContent>
                          </Select>
                          <Input
                            type="number"
                            min="1"
                            value={item.qty}
                            onChange={(e) => {
                              const updatedItems = [...newCombo.items];
                              updatedItems[index] = { ...item, qty: parseInt(e.target.value) || 1 };
                              setNewCombo(prev => ({ ...prev, items: updatedItems }));
                            }}
                            className="w-20"
                            placeholder="Qty"
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const updatedItems = newCombo.items.filter((_, i) => i !== index);
                              setNewCombo(prev => ({ ...prev, items: updatedItems }));
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setNewCombo(prev => ({
                            ...prev,
                            items: [...prev.items, { variant_id: 0, qty: 1 }]
                          }));
                        }}
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Add Item
                      </Button>
                    </div>
                  </div>

                  <div className="flex justify-end space-x-2">
                    <Button variant="outline" onClick={() => setShowAddComboDialog(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleCreateCombo} disabled={isLoading}>
                      {isLoading ? 'Creating...' : 'Create Combo'}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Combo Name</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {combos.map((combo) => (
                <TableRow key={combo.combo_id}>
                  <TableCell className="font-medium">{combo.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {combo.items?.length || 0} items
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={combo.is_active ? "default" : "secondary"}>
                      {combo.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex space-x-2">
                      <Button variant="outline" size="sm">
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TabsContent>

        <TabsContent value="calculator" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Calculator className="h-5 w-5" />
                <span>COGS Calculator</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="calcCountry">Country</Label>
                    <Select 
                      value={calculatorRequest.country_code}
                      onValueChange={(value) => setCalculatorRequest(prev => ({ ...prev, country_code: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select country" />
                      </SelectTrigger>
                      <SelectContent>
                        {COUNTRIES.map(country => (
                          <SelectItem key={country} value={country}>
                            {country}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="calcSupplier">Shipping Company</Label>
                    <Select 
                      value={calculatorRequest.shipping_company}
                      onValueChange={(value) => setCalculatorRequest(prev => ({ ...prev, shipping_company: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select supplier" />
                      </SelectTrigger>
                      <SelectContent>
                        {SUPPLIERS.map(supplier => (
                          <SelectItem key={supplier} value={supplier}>
                            {supplier}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="calcCurrency">Currency</Label>
                    <Select 
                      value={calculatorRequest.currency}
                      onValueChange={(value) => setCalculatorRequest(prev => ({ ...prev, currency: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select currency" />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map(currency => (
                          <SelectItem key={currency} value={currency}>
                            {currency}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <Label>Line Items</Label>
                    <div className="flex space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={loadProducts}
                        disabled={isLoading}
                      >
                        {isLoading ? 'Loading...' : 'Refresh Products'}
                      </Button>
                      <Button onClick={addLineItem} size="sm">
                        <Plus className="h-4 w-4 mr-1" />
                        Add Item
                      </Button>
                    </div>
                  </div>
                  {products.length === 0 && (
                    <div className="text-sm text-amber-600 bg-amber-50 p-2 rounded mb-2">
                      No products loaded. Make sure Shopify is connected and click "Refresh Products".
                    </div>
                  )}
                  {calculatorRequest.lines?.map((line, index) => (
                    <div key={index} className="flex space-x-2 mb-2">
                      <Select
                        value={line.variant_id.toString()}
                        onValueChange={(value) => updateLineItem(index, 'variant_id', parseInt(value))}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder={products.length === 0 ? "No products available" : "Select product variant"} />
                        </SelectTrigger>
                        <SelectContent>
                          {products.length === 0 ? (
                            <SelectItem value="0" disabled>No products available</SelectItem>
                          ) : (
                            products.map(product => 
                              product.variants.map(variant => (
                                <SelectItem key={variant.id} value={variant.id.toString()}>
                                  {product.title} - {variant.title}
                                </SelectItem>
                              ))
                            )
                          )}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        placeholder="Quantity"
                        value={line.qty}
                        onChange={(e) => updateLineItem(index, 'qty', parseInt(e.target.value) || 0)}
                        className="w-24"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => removeLineItem(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                <Button onClick={handleCalculateCost} className="w-full" disabled={isLoading}>
                  <Calculator className="h-4 w-4 mr-2" />
                  {isLoading ? 'Calculating...' : 'Calculate COGS'}
                </Button>

                {calculatorResult && (
                  <div className="bg-green-50 p-4 rounded-lg">
                    <h4 className="font-semibold text-green-800 mb-2">Cost Calculation Result</h4>
                    <div className="space-y-1 text-sm">
                      <div>Product Cost: ${calculatorResult.product_cost.toFixed(2)}</div>
                      <div>Shipping Cost: ${calculatorResult.shipping_cost.toFixed(2)}</div>
                      <div className="font-semibold text-green-800">
                        Total COGS: ${calculatorResult.total_cost.toFixed(2)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
