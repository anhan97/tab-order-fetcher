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
import { Plus, Edit, Trash2, Package, Globe, Truck, DollarSign, Save, X, Calculator } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { COGSApiClient, COGSConfigData } from '@/utils/cogsApi';
import { COGSConfig, ComboPricing, ComboPricingData } from '@/types/order';

interface Product {
  id: string;
  title: string;
  variants: Array<{
    id: string;
    title: string;
    sku: string;
  }>;
}

interface COGSManagementProps {
  onUpdateCOGS: (configs: COGSConfig[]) => void;
  initialConfigs?: COGSConfig[];
}

const SUPPLIERS = [
  'YunTu',
  'Shengtu Logistics', 
  'Yuanpeng Logistics',
  'DHL',
  'FedEx',
  'UPS',
  'Custom'
];

const COUNTRIES = [
  'US', 'UK', 'CA', 'AU', 'DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'NO', 'DK', 'FI',
  'JP', 'KR', 'SG', 'HK', 'TW', 'MY', 'TH', 'PH', 'ID', 'VN', 'IN', 'BR', 'MX'
];

const COMBO_TYPES = [
  { value: 'single', label: 'Single (1 item)' },
  { value: 'combo2', label: 'Combo 2 (2 items)' },
  { value: 'combo3', label: 'Combo 3 (3 items)' },
  { value: 'combo4', label: 'Combo 4 (4 items)' },
  { value: 'combo5+', label: 'Combo 5+ (5+ items)' }
];

export const COGSManagement: React.FC<COGSManagementProps> = ({ onUpdateCOGS, initialConfigs = [] }) => {
  const [cogsConfigs, setCogsConfigs] = useState<COGSConfig[]>(initialConfigs);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<COGSConfig | null>(null);
  const [cogsApiClient, setCogsApiClient] = useState<COGSApiClient | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showComboDialog, setShowComboDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showCalculatorDialog, setShowCalculatorDialog] = useState(false);
  const [editingConfig, setEditingConfig] = useState<COGSConfig | null>(null);
  const [editingCombo, setEditingCombo] = useState<ComboPricing | null>(null);
  const { toast } = useToast();

  // Form states
  const [newConfig, setNewConfig] = useState<Partial<COGSConfigData>>({
    baseCost: 0,
    handlingFee: 0,
    comboPricing: []
  });
  const [newCombo, setNewCombo] = useState<ComboPricingData>({
    supplier: '',
    country: '',
    comboType: 'single',
    quantity: 1,
    productCost: 0,
    shippingCost: 0,
    totalCost: 0,
    isActive: true
  });

  // Calculator state
  const [calculatorInput, setCalculatorInput] = useState({
    variantId: '',
    country: '',
    quantity: 1
  });
  const [calculatorResult, setCalculatorResult] = useState<any>(null);

  useEffect(() => {
    initializeClient();
  }, []);

  useEffect(() => {
    if (cogsApiClient) {
      loadCOGSConfigs();
      fetchProducts();
    }
  }, [cogsApiClient]);

  const initializeClient = () => {
    try {
      const storeUrl = localStorage.getItem('shopify_store_url');
      if (!storeUrl) {
        toast({
          title: "Error",
          description: "Shopify store not connected",
          variant: "destructive",
        });
        return;
      }

      const storeId = storeUrl.replace('.myshopify.com', '');
      const userId = 'default-user';
      
      const client = new COGSApiClient(userId, storeId);
      setCogsApiClient(client);
    } catch (error) {
      console.error('Error initializing COGS client:', error);
      toast({
        title: "Error",
        description: "Failed to initialize COGS client",
        variant: "destructive",
      });
    }
  };

  const loadCOGSConfigs = async () => {
    if (!cogsApiClient) return;
    
    try {
      const configs = await cogsApiClient.getCOGSConfigs();
      setCogsConfigs(configs);
      onUpdateCOGS(configs);
    } catch (error) {
      console.error('Error loading COGS configs:', error);
    }
  };

  const fetchProducts = async () => {
    try {
      const storeUrl = localStorage.getItem('shopify_store_url');
      const accessToken = localStorage.getItem('shopify_access_token');
      
      if (!storeUrl || !accessToken) {
        console.log('Shopify not connected, skipping product fetch');
        return;
      }

      const response = await fetch('/api/shopify/products?status=active&limit=50', {
        headers: {
          'X-Shopify-Store-Domain': storeUrl,
          'X-Shopify-Access-Token': accessToken,
        },
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch products');
      }
      
      const data = await response.json();
      setProducts(data.products || []);
    } catch (error) {
      console.error('Error fetching products:', error);
    }
  };

  const handleAddConfig = async () => {
    if (!cogsApiClient || !newConfig.productSKU || !newConfig.variantId) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsLoading(true);
      await cogsApiClient.createCOGSConfig(newConfig as COGSConfigData);
      await loadCOGSConfigs();
      setShowAddDialog(false);
      setNewConfig({ baseCost: 0, handlingFee: 0, comboPricing: [] });
      toast({
        title: "Success",
        description: "COGS configuration added successfully",
      });
    } catch (error) {
      console.error('Error adding COGS config:', error);
      toast({
        title: "Error",
        description: "Failed to add COGS configuration",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditConfig = async () => {
    if (!cogsApiClient || !editingConfig) {
      return;
    }

    try {
      setIsLoading(true);
      await cogsApiClient.updateCOGSConfig(editingConfig.id!, {
        baseCost: editingConfig.baseCost,
        handlingFee: editingConfig.handlingFee,
        description: editingConfig.description
      });
      await loadCOGSConfigs();
      setShowEditDialog(false);
      setEditingConfig(null);
      toast({
        title: "Success",
        description: "COGS configuration updated successfully",
      });
    } catch (error) {
      console.error('Error updating COGS config:', error);
      toast({
        title: "Error",
        description: "Failed to update COGS configuration",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteConfig = async (configId: string) => {
    if (!cogsApiClient) return;

    try {
      await cogsApiClient.deleteCOGSConfig(configId);
      await loadCOGSConfigs();
      toast({
        title: "Success",
        description: "COGS configuration deleted successfully",
      });
    } catch (error) {
      console.error('Error deleting COGS config:', error);
      toast({
        title: "Error",
        description: "Failed to delete COGS configuration",
        variant: "destructive",
      });
    }
  };

  const handleAddCombo = async () => {
    if (!cogsApiClient || !selectedConfig || !newCombo.supplier || !newCombo.country) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsLoading(true);
      // Calculate total cost
      const totalCost = newCombo.productCost * newCombo.quantity + newCombo.shippingCost;
      const comboData = { ...newCombo, totalCost };
      
      await cogsApiClient.addComboPricing(selectedConfig.id!, comboData);
      await loadCOGSConfigs();
      setShowComboDialog(false);
      setNewCombo({
        supplier: '',
        country: '',
        comboType: 'single',
        quantity: 1,
        productCost: 0,
        shippingCost: 0,
        totalCost: 0,
        isActive: true
      });
      toast({
        title: "Success",
        description: "Combo pricing added successfully",
      });
    } catch (error) {
      console.error('Error adding combo pricing:', error);
      toast({
        title: "Error",
        description: "Failed to add combo pricing",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleEditCombo = async () => {
    if (!cogsApiClient || !editingCombo) {
      return;
    }

    try {
      setIsLoading(true);
      const totalCost = editingCombo.productCost * editingCombo.quantity + editingCombo.shippingCost;
      const comboData = { ...editingCombo, totalCost };
      
      await cogsApiClient.updateComboPricing(editingCombo.id!, comboData);
      await loadCOGSConfigs();
      setShowComboDialog(false);
      setEditingCombo(null);
      toast({
        title: "Success",
        description: "Combo pricing updated successfully",
      });
    } catch (error) {
      console.error('Error updating combo pricing:', error);
      toast({
        title: "Error",
        description: "Failed to update combo pricing",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteCombo = async (comboId: string) => {
    if (!cogsApiClient) return;

    try {
      await cogsApiClient.deleteComboPricing(comboId);
      await loadCOGSConfigs();
      toast({
        title: "Success",
        description: "Combo pricing deleted successfully",
      });
    } catch (error) {
      console.error('Error deleting combo pricing:', error);
      toast({
        title: "Error",
        description: "Failed to delete combo pricing",
        variant: "destructive",
      });
    }
  };

  const handleCalculateCOGS = async () => {
    if (!cogsApiClient || !calculatorInput.variantId || !calculatorInput.country) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    try {
      const result = await cogsApiClient.getPricingForOrder(
        calculatorInput.variantId,
        calculatorInput.country,
        calculatorInput.quantity
      );
      setCalculatorResult(result);
    } catch (error) {
      console.error('Error calculating COGS:', error);
      toast({
        title: "Error",
        description: "Failed to calculate COGS",
        variant: "destructive",
      });
    }
  };

  const updateComboQuantity = (comboType: string) => {
    const quantityMap: { [key: string]: number } = {
      'single': 1,
      'combo2': 2,
      'combo3': 3,
      'combo4': 4,
      'combo5+': 5
    };
    
    const quantity = quantityMap[comboType] || 1;
    
    if (editingCombo) {
      setEditingCombo(prev => prev ? { ...prev, comboType, quantity } : null);
    } else {
      setNewCombo(prev => ({ ...prev, comboType, quantity }));
    }
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="configs" className="w-full">
        <TabsList>
          <TabsTrigger value="configs">Products</TabsTrigger>
          <TabsTrigger value="combos">Combo Pricing</TabsTrigger>
          <TabsTrigger value="calculator">COGS Calculator</TabsTrigger>
        </TabsList>
        
        <TabsContent value="configs" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-semibold">COGS Configurations</h3>
              <p className="text-sm text-slate-600">
                Manage your Cost of Goods Sold with flexible combo-based pricing
              </p>
            </div>
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Product
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Add COGS Configuration</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="product">Product</Label>
                      <Select onValueChange={(value) => {
                        const product = products.find(p => p.id === value);
                        if (product) {
                          setNewConfig(prev => ({
                            ...prev,
                            productId: product.id,
                            productTitle: product.title
                          }));
                        }
                      }}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select product" />
                        </SelectTrigger>
                        <SelectContent>
                          {products.map(product => (
                            <SelectItem key={product.id} value={product.id}>
                              {product.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="variant">Variant</Label>
                      <Select onValueChange={(value) => {
                        const product = products.find(p => p.variants.some(v => v.id === value));
                        const variant = product?.variants.find(v => v.id === value);
                        if (variant) {
                          setNewConfig(prev => ({
                            ...prev,
                            variantId: variant.id,
                            variantTitle: variant.title,
                            productSKU: variant.sku
                          }));
                        }
                      }}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select variant" />
                        </SelectTrigger>
                        <SelectContent>
                          {products.map(product => 
                            product.variants.map(variant => (
                              <SelectItem key={variant.id} value={variant.id}>
                                {product.title} - {variant.title}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="baseCost">Base Cost ($)</Label>
                      <Input
                        id="baseCost"
                        type="number"
                        step="0.01"
                        value={newConfig.baseCost || 0}
                        onChange={(e) => setNewConfig(prev => ({ ...prev, baseCost: parseFloat(e.target.value) || 0 }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="handlingFee">Handling Fee ($)</Label>
                      <Input
                        id="handlingFee"
                        type="number"
                        step="0.01"
                        value={newConfig.handlingFee || 0}
                        onChange={(e) => setNewConfig(prev => ({ ...prev, handlingFee: parseFloat(e.target.value) || 0 }))}
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="description">Description</Label>
                    <Input
                      id="description"
                      value={newConfig.description || ''}
                      onChange={(e) => setNewConfig(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Optional description"
                    />
                  </div>
                  <div className="flex justify-end space-x-2">
                    <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                      Cancel
                    </Button>
                    <Button onClick={handleAddConfig} disabled={isLoading}>
                      {isLoading ? 'Adding...' : 'Add Configuration'}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Variant</TableHead>
                <TableHead>Base Cost</TableHead>
                <TableHead>Handling Fee</TableHead>
                <TableHead>Combo Pricing</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cogsConfigs.map((config) => (
                <TableRow key={config.id}>
                  <TableCell className="font-medium">{config.productTitle}</TableCell>
                  <TableCell>{config.variantTitle}</TableCell>
                  <TableCell>${config.baseCost.toFixed(2)}</TableCell>
                  <TableCell>${config.handlingFee.toFixed(2)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {config.comboPricing?.length || 0} combos
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedConfig(config);
                          setShowComboDialog(true);
                        }}
                      >
                        <Package className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingConfig(config);
                          setShowEditDialog(true);
                        }}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteConfig(config.id!)}
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
          {selectedConfig && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">
                  Combo Pricing for {selectedConfig.productTitle} - {selectedConfig.variantTitle}
                </h3>
                <Dialog open={showComboDialog} onOpenChange={setShowComboDialog}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Combo Pricing
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>
                        {editingCombo ? 'Edit Combo Pricing' : 'Add Combo Pricing'}
                      </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="supplier">Supplier</Label>
                          <Select 
                            value={editingCombo?.supplier || newCombo.supplier}
                            onValueChange={(value) => {
                              if (editingCombo) {
                                setEditingCombo(prev => prev ? { ...prev, supplier: value } : null);
                              } else {
                                setNewCombo(prev => ({ ...prev, supplier: value }));
                              }
                            }}
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
                          <Label htmlFor="country">Country</Label>
                          <Select 
                            value={editingCombo?.country || newCombo.country}
                            onValueChange={(value) => {
                              if (editingCombo) {
                                setEditingCombo(prev => prev ? { ...prev, country: value } : null);
                              } else {
                                setNewCombo(prev => ({ ...prev, country: value }));
                              }
                            }}
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
                      </div>
                      <div>
                        <Label htmlFor="comboType">Combo Type</Label>
                        <Select 
                          value={editingCombo?.comboType || newCombo.comboType}
                          onValueChange={(value) => updateComboQuantity(value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select combo type" />
                          </SelectTrigger>
                          <SelectContent>
                            {COMBO_TYPES.map(combo => (
                              <SelectItem key={combo.value} value={combo.value}>
                                {combo.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="productCost">Product Cost per Unit ($)</Label>
                          <Input
                            id="productCost"
                            type="number"
                            step="0.01"
                            value={editingCombo?.productCost || newCombo.productCost}
                            onChange={(e) => {
                              const value = parseFloat(e.target.value) || 0;
                              if (editingCombo) {
                                setEditingCombo(prev => prev ? { ...prev, productCost: value } : null);
                              } else {
                                setNewCombo(prev => ({ ...prev, productCost: value }));
                              }
                            }}
                          />
                        </div>
                        <div>
                          <Label htmlFor="shippingCost">Shipping Cost ($)</Label>
                          <Input
                            id="shippingCost"
                            type="number"
                            step="0.01"
                            value={editingCombo?.shippingCost || newCombo.shippingCost}
                            onChange={(e) => {
                              const value = parseFloat(e.target.value) || 0;
                              if (editingCombo) {
                                setEditingCombo(prev => prev ? { ...prev, shippingCost: value } : null);
                              } else {
                                setNewCombo(prev => ({ ...prev, shippingCost: value }));
                              }
                            }}
                          />
                        </div>
                      </div>
                      <div className="bg-slate-50 p-3 rounded-lg">
                        <Label>Total Cost Calculation</Label>
                        <div className="text-sm text-slate-600 mt-1">
                          Product Cost: ${(editingCombo?.productCost || newCombo.productCost).toFixed(2)} × {(editingCombo?.quantity || newCombo.quantity)} = ${((editingCombo?.productCost || newCombo.productCost) * (editingCombo?.quantity || newCombo.quantity)).toFixed(2)}
                        </div>
                        <div className="text-sm text-slate-600">
                          Shipping Cost: ${(editingCombo?.shippingCost || newCombo.shippingCost).toFixed(2)}
                        </div>
                        <div className="text-sm font-semibold text-slate-800">
                          Total Cost: ${(((editingCombo?.productCost || newCombo.productCost) * (editingCombo?.quantity || newCombo.quantity)) + (editingCombo?.shippingCost || newCombo.shippingCost)).toFixed(2)}
                        </div>
                      </div>
                      <div className="flex justify-end space-x-2">
                        <Button variant="outline" onClick={() => {
                          setShowComboDialog(false);
                          setEditingCombo(null);
                        }}>
                          Cancel
                        </Button>
                        <Button onClick={editingCombo ? handleEditCombo : handleAddCombo} disabled={isLoading}>
                          {isLoading ? 'Saving...' : (editingCombo ? 'Update Combo' : 'Add Combo')}
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Country</TableHead>
                    <TableHead>Combo Type</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Product Cost/Unit</TableHead>
                    <TableHead>Shipping Cost</TableHead>
                    <TableHead>Total Cost</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedConfig.comboPricing?.map((combo) => (
                    <TableRow key={combo.id}>
                      <TableCell className="flex items-center space-x-1">
                        <Truck className="h-4 w-4" />
                        <span>{combo.supplier}</span>
                      </TableCell>
                      <TableCell className="flex items-center space-x-1">
                        <Globe className="h-4 w-4" />
                        <span>{combo.country}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {COMBO_TYPES.find(c => c.value === combo.comboType)?.label || combo.comboType}
                        </Badge>
                      </TableCell>
                      <TableCell>{combo.quantity}</TableCell>
                      <TableCell className="flex items-center space-x-1">
                        <DollarSign className="h-4 w-4" />
                        <span>${combo.productCost.toFixed(2)}</span>
                      </TableCell>
                      <TableCell className="flex items-center space-x-1">
                        <Truck className="h-4 w-4" />
                        <span>${combo.shippingCost.toFixed(2)}</span>
                      </TableCell>
                      <TableCell className="font-semibold">
                        ${combo.totalCost.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <div className="flex space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingCombo(combo);
                              setShowComboDialog(true);
                            }}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDeleteCombo(combo.id!)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
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
                    <Label htmlFor="calcVariant">Product Variant</Label>
                    <Select onValueChange={(value) => setCalculatorInput(prev => ({ ...prev, variantId: value }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select variant" />
                      </SelectTrigger>
                      <SelectContent>
                        {cogsConfigs.map(config => (
                          <SelectItem key={config.variantId} value={config.variantId}>
                            {config.productTitle} - {config.variantTitle}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="calcCountry">Country</Label>
                    <Select onValueChange={(value) => setCalculatorInput(prev => ({ ...prev, country: value }))}>
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
                    <Label htmlFor="calcQuantity">Quantity</Label>
                    <Input
                      id="calcQuantity"
                      type="number"
                      min="1"
                      value={calculatorInput.quantity}
                      onChange={(e) => setCalculatorInput(prev => ({ ...prev, quantity: parseInt(e.target.value) || 1 }))}
                    />
                  </div>
                </div>
                <Button onClick={handleCalculateCOGS} className="w-full">
                  <Calculator className="h-4 w-4 mr-2" />
                  Calculate COGS
                </Button>
                
                {calculatorResult && (
                  <div className="bg-green-50 p-4 rounded-lg">
                    <h4 className="font-semibold text-green-800 mb-2">COGS Calculation Result</h4>
                    <div className="space-y-1 text-sm">
                      <div>Combo Type: {calculatorResult.calculatedCost.comboType}</div>
                      <div>Product Cost per Unit: ${calculatorResult.calculatedCost.productCostPerUnit.toFixed(2)}</div>
                      <div>Total Product Cost: ${calculatorResult.calculatedCost.totalProductCost.toFixed(2)}</div>
                      <div>Shipping Cost: ${calculatorResult.calculatedCost.shippingCost.toFixed(2)}</div>
                      <div className="font-semibold text-green-800">
                        Total COGS: ${calculatorResult.calculatedCost.totalCost.toFixed(2)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit COGS Configuration Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit COGS Configuration</DialogTitle>
          </DialogHeader>
          {editingConfig && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="editBaseCost">Base Cost ($)</Label>
                  <Input
                    id="editBaseCost"
                    type="number"
                    step="0.01"
                    value={editingConfig.baseCost}
                    onChange={(e) => setEditingConfig(prev => prev ? { ...prev, baseCost: parseFloat(e.target.value) || 0 } : null)}
                  />
                </div>
                <div>
                  <Label htmlFor="editHandlingFee">Handling Fee ($)</Label>
                  <Input
                    id="editHandlingFee"
                    type="number"
                    step="0.01"
                    value={editingConfig.handlingFee}
                    onChange={(e) => setEditingConfig(prev => prev ? { ...prev, handlingFee: parseFloat(e.target.value) || 0 } : null)}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="editDescription">Description</Label>
                <Input
                  id="editDescription"
                  value={editingConfig.description || ''}
                  onChange={(e) => setEditingConfig(prev => prev ? { ...prev, description: e.target.value } : null)}
                  placeholder="Optional description"
                />
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => {
                  setShowEditDialog(false);
                  setEditingConfig(null);
                }}>
                  Cancel
                </Button>
                <Button onClick={handleEditConfig} disabled={isLoading}>
                  {isLoading ? 'Updating...' : 'Update Configuration'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};