import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Edit, Trash2, Package, Calculator, Upload, Download, Save, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { CogsConfig, ProductCog, ComboCog, CogsResult } from '@/types/minimalCogs';
import {
  calculateProductCogs,
  calculateComboCogs,
  calculateOrderCogs,
  validateCogsConfig
} from '@/utils/minimalCogsResolver';
import { sampleCogsConfig } from '@/utils/sampleMinimalCogs';

interface MinimalCOGSManagementProps {
  onUpdateCOGS?: (config: CogsConfig) => void;
}

const COUNTRIES = ['US', 'UK', 'CA', 'AU', 'DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'NO', 'DK', 'FI'];
const SHIPPING_COMPANIES = ['YunTu', 'Shengtu Logistics', 'Yuanpeng Logistics', 'DHL', 'FedEx', 'UPS'];
const CURRENCIES = ['USD', 'GBP', 'CAD', 'EUR', 'AUD'];

export const MinimalCOGSManagement: React.FC<MinimalCOGSManagementProps> = ({ onUpdateCOGS }) => {
  const [config, setConfig] = useState<CogsConfig>(sampleCogsConfig);
  const [products, setProducts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showAddProductDialog, setShowAddProductDialog] = useState(false);
  const [showEditProductDialog, setShowEditProductDialog] = useState(false);
  const [showAddComboDialog, setShowAddComboDialog] = useState(false);
  const [showEditComboDialog, setShowEditComboDialog] = useState(false);
  const [showCalculatorDialog, setShowCalculatorDialog] = useState(false);
  const [showJsonEditor, setShowJsonEditor] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [calculatorResult, setCalculatorResult] = useState<CogsResult | null>(null);
  const [editingProduct, setEditingProduct] = useState<ProductCog | null>(null);
  const [editingCombo, setEditingCombo] = useState<ComboCog | null>(null);
  const { toast } = useToast();

  // Form states
  const [newProduct, setNewProduct] = useState<Partial<ProductCog>>({
    variant_id: 0,
    sku: '',
    base_cost: 0,
    overrides: []
  });

  const [newCombo, setNewCombo] = useState<Partial<ComboCog>>({
    combo_id: '',
    name: '',
    items: [],
    cogs_rule: { mode: 'sum', discount_type: 'fixed', discount_value: 0 },
    overrides: []
  });
  const [comboQuantity, setComboQuantity] = useState<number>(1);
  const [selectedProducts, setSelectedProducts] = useState<{ variant_id: number, qty: number }[]>([]);
  const [comboDiscountType, setComboDiscountType] = useState<'percent' | 'fixed'>('fixed');
  const [comboDiscountValue, setComboDiscountValue] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Debounced auto-save to database
  const [saveTimeout, setSaveTimeout] = useState<NodeJS.Timeout | null>(null);

  const saveToDatabase = async (config: CogsConfig) => {
    try {
      // Use relative URL - Vite proxy will handle routing to backend
      const apiBaseUrl = '/api';

      // Transform CogsConfig to backend format (COGSConfigData[])
      const backendConfigs = config.products.map(product => ({
        productSKU: product.sku || '',
        variantId: product.variant_id,
        productId: 0, // We might need to fetch this or store it in ProductCog
        productTitle: '', // Optional, backend might fetch it
        variantTitle: '', // Optional
        baseCost: product.base_cost,
        handlingFee: 0,
        description: '',
        overrides: product.overrides || []
      }));

      // We need to get productId and titles. 
      // Since ProductCog in minimalCogs.ts doesn't have them, we might need to rely on what's available.
      // Or better, we should update ProductCog to include them if possible, or fetch from Shopify data.
      // For now, let's try to map what we have. The backend requires productId, productTitle, variantTitle.
      // If these are missing, the backend validation will fail.

      // Ideally, we should merge with the `products` state which has full Shopify data.
      // But `saveToDatabase` receives `config` which is `CogsConfig`.

      // Let's look at where `saveToDatabase` is called. It's called with `cogsConfig`.
      // `cogsConfig` is updated when `products` (Shopify data) changes? No.

      // Let's fetch the current products state to enrich the data.
      // But `products` is a state variable in this component.

      const enrichedConfigs = backendConfigs.map(cfg => {
        const productData = products.find(p => p.variants.some(v => v.id === cfg.variantId));
        const variantData = productData?.variants.find(v => v.id === cfg.variantId);

        return {
          ...cfg,
          productId: productData?.id || 0,
          productTitle: productData?.title || 'Unknown Product',
          variantTitle: variantData?.title || 'Default Title'
        };
      });

      const response = await fetch(`${apiBaseUrl}/cogs/configs/bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'user_123', // TODO: Get from auth context
          'X-Store-Id': 'store_123' // TODO: Get from auth context
        },
        body: JSON.stringify({ configs: enrichedConfigs }),
      });

      if (!response.ok) {
        console.warn('Failed to save COGS config to database:', response.statusText);
      } else {
        console.log('COGS config saved successfully');
      }
    } catch (error) {
      console.warn('Error saving COGS config to database:', error);
    }
  };

  // Debounced save function
  const debouncedSave = (config: CogsConfig) => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    const timeout = setTimeout(() => {
      saveToDatabase(config);
    }, 1000); // 1 second debounce

    setSaveTimeout(timeout);
  };

  // Load COGS config from database
  const loadFromDatabase = async () => {
    try {
      // Use relative URL - Vite proxy will handle routing to backend
      const apiBaseUrl = '/api';

      const response = await fetch(`${apiBaseUrl}/cogs/configs`, {
        headers: {
          'X-User-Id': 'user_123', // TODO: Get from auth context
          'X-Store-Id': 'store_123' // TODO: Get from auth context
        }
      });

      if (response.ok) {
        const data = await response.json();
        // Backend returns { configs: COGSConfigData[] }
        if (data.configs && Array.isArray(data.configs)) {
          // Map backend data to frontend format
          const mappedProducts: ProductCog[] = data.configs.map((cfg: any) => ({
            variant_id: Number(cfg.variantId),
            sku: cfg.productSKU,
            base_cost: cfg.baseCost,
            overrides: cfg.overrides?.map((o: any) => ({
              country: o.country,
              shipping_company: o.shipping_company,
              cost: o.cost
            })) || []
          }));

          // Merge with existing products to keep other data if needed, 
          // but typically we want the DB to be the source of truth for COGS.
          // However, we need to ensure we don't lose products that are in Shopify but not in DB yet.
          // The `products` state is initialized from Shopify data.
          // We should update the `products` state with the loaded COGS data.

          // But `loadFromDatabase` updates `config` state.
          // And `config` state drives the UI?
          // Actually `products` state drives the UI table.
          // `config` seems to be an intermediate state or used for JSON view.

          // Let's look at `useEffect` on line 197: `loadProducts()` is called when `config` changes.
          // `loadProducts` likely merges `config` with Shopify data.

          setConfig(prev => ({
            ...prev,
            products: mappedProducts
          }));

          // Also update the parent if needed
          onUpdateCOGS?.({
            ...config,
            products: mappedProducts
          });
        }
      }
    } catch (error) {
      console.warn('Error loading COGS config from database:', error);
    }
  };

  // Load config from database on mount
  useEffect(() => {
    loadFromDatabase();
  }, []);

  // Filter products based on search query
  const filteredProducts = products.filter(product => {
    if (!searchQuery) return true;

    const query = searchQuery.toLowerCase();
    return (
      product.title.toLowerCase().includes(query) ||
      product.variants.some((variant: any) =>
        variant.title.toLowerCase().includes(query) ||
        variant.sku?.toLowerCase().includes(query) ||
        variant.id.toString().includes(query)
      )
    );
  });

  // Calculator states
  const [calcVariantId, setCalcVariantId] = useState<number>(0);
  const [calcComboId, setCalcComboId] = useState<string>('');
  const [calcCountry, setCalcCountry] = useState<string>('US');
  const [calcShipper, setCalcShipper] = useState<string>('YunTu');
  const [calcQuantity, setCalcQuantity] = useState<number>(1);
  const [calcType, setCalcType] = useState<'product' | 'combo'>('product');

  useEffect(() => {
    setJsonText(JSON.stringify(config, null, 2));
    loadProducts();
  }, [config]);

  const loadProducts = async () => {
    try {
      const storeUrl = localStorage.getItem('shopify_store_url');
      const accessToken = localStorage.getItem('shopify_access_token');

      if (!storeUrl || !accessToken) {
        console.log('Shopify not connected, skipping product fetch');
        return;
      }

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

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to fetch products:', response.status, errorText);
        return;
      }

      const data = await response.json();
      console.log('Products loaded:', data.products?.length || 0, 'products');
      setProducts(data.products || []);
    } catch (error) {
      console.error('Error fetching products:', error);
    }
  };

  const handleSaveConfig = () => {
    try {
      const newConfig = JSON.parse(jsonText);
      const validation = validateCogsConfig(newConfig);

      if (!validation.valid) {
        toast({
          title: "Invalid Configuration",
          description: validation.errors.join(', '),
          variant: "destructive",
        });
        return;
      }

      setConfig(newConfig);
      onUpdateCOGS?.(newConfig);
      setShowJsonEditor(false);
      toast({
        title: "Success",
        description: "COGS configuration saved successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Invalid JSON format",
        variant: "destructive",
      });
    }
  };

  const handleAddProduct = () => {
    if (!newProduct.variant_id || !newProduct.base_cost) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    const updatedConfig = {
      ...config,
      products: [...config.products, newProduct as ProductCog]
    };
    setConfig(updatedConfig);
    onUpdateCOGS?.(updatedConfig);
    debouncedSave(updatedConfig);
    setShowAddProductDialog(false);
    setNewProduct({ variant_id: 0, sku: '', base_cost: 0, overrides: [] });
    toast({
      title: "Success",
      description: "Product added successfully",
    });
  };

  const handleEditProduct = (product: ProductCog) => {
    setEditingProduct(product);
    setNewProduct(product);
    setShowEditProductDialog(true);
  };

  const handleUpdateProduct = () => {
    if (!editingProduct || !newProduct.variant_id || !newProduct.base_cost) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }

    const updatedConfig = {
      ...config,
      products: config.products.map(p =>
        p.variant_id === editingProduct.variant_id ? newProduct as ProductCog : p
      )
    };
    setConfig(updatedConfig);
    onUpdateCOGS?.(updatedConfig);
    debouncedSave(updatedConfig);
    setShowEditProductDialog(false);
    setEditingProduct(null);
    setNewProduct({ variant_id: 0, sku: '', base_cost: 0, overrides: [] });
    toast({
      title: "Success",
      description: "Product updated successfully",
    });
  };

  const handleDeleteProduct = (variantId: number) => {
    const updatedConfig = {
      ...config,
      products: config.products.filter(p => p.variant_id !== variantId)
    };
    setConfig(updatedConfig);
    onUpdateCOGS?.(updatedConfig);
    debouncedSave(updatedConfig);
    toast({
      title: "Success",
      description: "Product deleted successfully",
    });
  };

  const handleAddCombo = () => {
    if (!newCombo.combo_id || !newCombo.name || selectedProducts.length === 0) {
      toast({
        title: "Error",
        description: "Please fill in all required fields and select at least one product",
        variant: "destructive",
      });
      return;
    }

    const comboItems = selectedProducts.map(product => ({
      variant_id: product.variant_id,
      qty: product.qty
    }));

    const combo: ComboCog = {
      combo_id: newCombo.combo_id!,
      name: newCombo.name!,
      items: comboItems,
      cogs_rule: {
        mode: 'sum',
        discount_type: comboDiscountType,
        discount_value: comboDiscountValue
      },
      trigger_quantity: comboQuantity,
      overrides: []
    };

    const updatedConfig = {
      ...config,
      combos: [...(config.combos || []), combo]
    };
    setConfig(updatedConfig);
    onUpdateCOGS?.(updatedConfig);
    debouncedSave(updatedConfig);
    setShowAddComboDialog(false);
    setNewCombo({ combo_id: '', name: '', items: [], cogs_rule: { mode: 'sum', discount_type: 'fixed', discount_value: 0 }, overrides: [] });
    setSelectedProducts([]);
    setComboQuantity(1);
    setComboDiscountType('fixed');
    setComboDiscountValue(0);
    toast({
      title: "Success",
      description: "Combo added successfully",
    });
  };

  const handleEditCombo = (combo: ComboCog) => {
    setEditingCombo(combo);
    setNewCombo(combo);
    setSelectedProducts(combo.items.map(item => ({ variant_id: item.variant_id, qty: item.qty })));
    setComboDiscountType(combo.cogs_rule.discount_type || 'fixed');
    setComboDiscountValue(combo.cogs_rule.discount_value || 0);
    setComboQuantity(combo.trigger_quantity || combo.items.reduce((sum, item) => sum + item.qty, 0));
    setShowEditComboDialog(true);
  };

  const handleUpdateCombo = () => {
    if (!editingCombo || !newCombo.combo_id || !newCombo.name || selectedProducts.length === 0) {
      toast({
        title: "Error",
        description: "Please fill in all required fields and select at least one product",
        variant: "destructive",
      });
      return;
    }

    const comboItems = selectedProducts.map(product => ({
      variant_id: product.variant_id,
      qty: product.qty
    }));

    const updatedCombo: ComboCog = {
      combo_id: newCombo.combo_id!,
      name: newCombo.name!,
      items: comboItems,
      cogs_rule: {
        mode: 'sum',
        discount_type: comboDiscountType,
        discount_value: comboDiscountValue
      },
      trigger_quantity: comboQuantity,
      overrides: []
    };

    const updatedConfig = {
      ...config,
      combos: config.combos?.map(c =>
        c.combo_id === editingCombo.combo_id ? updatedCombo : c
      ) || []
    };
    setConfig(updatedConfig);
    onUpdateCOGS?.(updatedConfig);
    debouncedSave(updatedConfig);
    setShowEditComboDialog(false);
    setEditingCombo(null);
    setNewCombo({ combo_id: '', name: '', items: [], cogs_rule: { mode: 'sum', discount_type: 'fixed', discount_value: 0 }, overrides: [] });
    setSelectedProducts([]);
    setComboQuantity(1);
    setComboDiscountType('fixed');
    setComboDiscountValue(0);
    toast({
      title: "Success",
      description: "Combo updated successfully",
    });
  };

  const handleDeleteCombo = (comboId: string) => {
    const updatedConfig = {
      ...config,
      combos: config.combos?.filter(c => c.combo_id !== comboId) || []
    };
    setConfig(updatedConfig);
    onUpdateCOGS?.(updatedConfig);
    debouncedSave(updatedConfig);
    toast({
      title: "Success",
      description: "Combo deleted successfully",
    });
  };

  const addProductToCombo = (variantId: number) => {
    const existingProduct = selectedProducts.find(p => p.variant_id === variantId);
    if (existingProduct) {
      setSelectedProducts(prev =>
        prev.map(p =>
          p.variant_id === variantId
            ? { ...p, qty: p.qty + 1 }
            : p
        )
      );
    } else {
      const newProducts = [...selectedProducts, { variant_id: variantId, qty: 1 }];
      setSelectedProducts(newProducts);
      // Auto-fill trigger quantity to match total number of products
      setComboQuantity(newProducts.length);
    }
  };

  const removeProductFromCombo = (variantId: number) => {
    const newProducts = selectedProducts.filter(p => p.variant_id !== variantId);
    setSelectedProducts(newProducts);
    // Auto-adjust trigger quantity to match remaining products
    if (newProducts.length > 0 && comboQuantity > newProducts.length) {
      setComboQuantity(newProducts.length);
    }
  };

  const updateProductQuantity = (variantId: number, qty: number) => {
    if (qty <= 0) {
      removeProductFromCombo(variantId);
      return;
    }
    setSelectedProducts(prev =>
      prev.map(p =>
        p.variant_id === variantId
          ? { ...p, qty }
          : p
      )
    );
  };

  const getProductName = (variantId: number) => {
    const product = products.find(p => p.variants.some((v: any) => v.id === variantId));
    const variant = product?.variants.find((v: any) => v.id === variantId);
    return variant ? `${product?.title} - ${variant.title}` : `Variant ${variantId}`;
  };

  const getVariantImage = (variantId: number) => {
    const product = products.find(p => p.variants.some((v: any) => v.id === variantId));
    const variant = product?.variants.find((v: any) => v.id === variantId);

    // Try to get image from variant first, then from product images
    if (variant?.image_id && product?.images) {
      const image = product.images.find((img: any) => img.id === variant.image_id);
      return image?.src;
    }

    // Fallback to first product image
    if (product?.images && product.images.length > 0) {
      return product.images[0].src;
    }

    return null;
  };

  const handleCalculate = () => {
    try {
      let result: CogsResult;

      if (calcType === 'product') {
        result = calculateProductCogs(config, calcVariantId, calcCountry, calcShipper, calcQuantity);
      } else {
        result = calculateComboCogs(config, calcComboId, calcCountry, calcShipper, calcQuantity);
      }

      setCalculatorResult(result);
      toast({
        title: "Success",
        description: "COGS calculated successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleExportConfig = () => {
    const dataStr = JSON.stringify(config, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'cogs-config.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportConfig = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedConfig = JSON.parse(e.target?.result as string);
        const validation = validateCogsConfig(importedConfig);

        if (!validation.valid) {
          toast({
            title: "Invalid Configuration",
            description: validation.errors.join(', '),
            variant: "destructive",
          });
          return;
        }

        setConfig(importedConfig);
        onUpdateCOGS?.(importedConfig);
        toast({
          title: "Success",
          description: "Configuration imported successfully",
        });
      } catch (error) {
        toast({
          title: "Error",
          description: "Invalid JSON file",
          variant: "destructive",
        });
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Minimal COGS Management</h2>
          <p className="text-slate-600">
            Simple JSON-based COGS system with products, combos, and overrides
          </p>
          <div className="text-sm text-gray-500 mt-1">
            Version: {config.version} | Currency: {config.currency} |
            Products: {config.products.length} | Combos: {config.combos?.length || 0}
          </div>
        </div>
        <div className="flex space-x-2">
          <Button onClick={() => setShowJsonEditor(true)} variant="outline">
            <FileText className="h-4 w-4 mr-2" />
            Edit JSON
          </Button>
          <Button onClick={handleExportConfig} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <label className="cursor-pointer">
            <Button asChild variant="outline">
              <span>
                <Upload className="h-4 w-4 mr-2" />
                Import
              </span>
            </Button>
            <input
              type="file"
              accept=".json"
              onChange={handleImportConfig}
              className="hidden"
            />
          </label>
        </div>
      </div>

      <Tabs defaultValue="products" className="w-full">
        <TabsList>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="combos">Combos</TabsTrigger>
          <TabsTrigger value="calculator">Calculator</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Products</h3>
            <div className="flex space-x-2">
              <Button onClick={loadProducts} variant="outline" disabled={isLoading}>
                <Package className="h-4 w-4 mr-2" />
                {isLoading ? 'Loading...' : 'Refresh Products'}
              </Button>
              <Dialog open={showAddProductDialog} onOpenChange={setShowAddProductDialog}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Product
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add New Product</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="productSelect">Select Product from Shopify</Label>
                      <Select
                        value={newProduct.variant_id?.toString() || ''}
                        onValueChange={(value) => {
                          const variantId = parseInt(value);
                          const product = products.find(p => p.variants.some((v: any) => v.id === variantId));
                          const variant = product?.variants.find((v: any) => v.id === variantId);
                          setNewProduct(prev => ({
                            ...prev,
                            variant_id: variantId,
                            sku: variant?.sku || ''
                          }));
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a product variant" />
                        </SelectTrigger>
                        <SelectContent>
                          {products.map(product =>
                            product.variants.map((variant: any) => (
                              <SelectItem key={variant.id} value={variant.id.toString()}>
                                {product.title} - {variant.title} ({variant.sku || 'No SKU'})
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="variantId">Or enter Variant ID manually</Label>
                      <Input
                        id="variantId"
                        type="number"
                        value={newProduct.variant_id || ''}
                        onChange={(e) => setNewProduct(prev => ({ ...prev, variant_id: parseInt(e.target.value) || 0 }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="sku">SKU (Optional)</Label>
                      <Input
                        id="sku"
                        value={newProduct.sku || ''}
                        onChange={(e) => setNewProduct(prev => ({ ...prev, sku: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="baseCost">Base Cost</Label>
                      <Input
                        id="baseCost"
                        type="number"
                        step="0.01"
                        value={newProduct.base_cost || ''}
                        onChange={(e) => setNewProduct(prev => ({ ...prev, base_cost: parseFloat(e.target.value) || 0 }))}
                      />
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setShowAddProductDialog(false)}>
                        Cancel
                      </Button>
                      <Button onClick={handleAddProduct}>
                        Add Product
                      </Button>
                    </DialogFooter>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          <div className="space-y-4">
            {/* Search Bar */}
            <div className="flex items-center space-x-4">
              <div className="flex-1">
                <Input
                  placeholder="Search products or variants..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="max-w-sm"
                />
              </div>
              <div className="text-sm text-gray-500">
                {filteredProducts.length} of {products.length} products
              </div>
            </div>

            {products.length === 0 ? (
              <div className="text-center py-8">
                <Package className="h-12 w-12 mx-auto text-gray-400 mb-2" />
                <p className="text-sm text-gray-500">No products loaded. Click "Refresh Products" to load from Shopify.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {filteredProducts.map((product) => (
                  <Card key={product.id} className="overflow-hidden">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          {/* Product Image */}
                          <div className="flex-shrink-0">
                            {product.images && product.images.length > 0 ? (
                              <img
                                src={product.images[0].src}
                                alt={product.title}
                                className="w-12 h-12 object-cover rounded-md border"
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                  e.currentTarget.nextElementSibling.style.display = 'flex';
                                }}
                              />
                            ) : null}
                            <div
                              className="w-12 h-12 bg-gray-100 rounded-md border flex items-center justify-center"
                              style={{ display: product.images && product.images.length > 0 ? 'none' : 'flex' }}
                            >
                              <Package className="h-6 w-6 text-gray-400" />
                            </div>
                          </div>

                          {/* Product Info */}
                          <div>
                            <h3 className="text-lg font-semibold">{product.title}</h3>
                            <p className="text-sm text-gray-500">
                              {product.variants.length} variant{product.variants.length !== 1 ? 's' : ''}
                            </p>
                          </div>
                        </div>

                        {/* Add All Variants Button */}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            product.variants.forEach((variant: any) => {
                              const existingProduct = config.products.find(p => p.variant_id === variant.id);
                              if (!existingProduct) {
                                const newProduct: ProductCog = {
                                  variant_id: variant.id,
                                  sku: variant.sku || '',
                                  base_cost: 0,
                                  overrides: []
                                };
                                const updatedConfig = {
                                  ...config,
                                  products: [...config.products, newProduct]
                                };
                                setConfig(updatedConfig);
                                onUpdateCOGS?.(updatedConfig);
                              }
                            });
                            toast({
                              title: "Success",
                              description: `Added ${product.variants.length} variants to COGS`,
                            });
                          }}
                        >
                          <Plus className="h-4 w-4 mr-2" />
                          Add All Variants
                        </Button>
                      </div>
                    </CardHeader>

                    <CardContent className="pt-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Variant</TableHead>
                            <TableHead>Base Cost</TableHead>
                            <TableHead>Overrides</TableHead>
                            <TableHead>Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {product.variants.map((variant: any) => {
                            const existingProduct = config.products.find(p => p.variant_id === variant.id);

                            return (
                              <TableRow key={variant.id}>
                                <TableCell>
                                  <div className="flex items-center space-x-3">
                                    {/* Variant Image */}
                                    <div className="flex-shrink-0">
                                      {getVariantImage(variant.id) ? (
                                        <img
                                          src={getVariantImage(variant.id)!}
                                          alt={variant.title}
                                          className="w-8 h-8 object-cover rounded border"
                                          onError={(e) => {
                                            e.currentTarget.style.display = 'none';
                                            e.currentTarget.nextElementSibling.style.display = 'flex';
                                          }}
                                        />
                                      ) : null}
                                      <div
                                        className="w-8 h-8 bg-gray-100 rounded border flex items-center justify-center"
                                        style={{ display: getVariantImage(variant.id) ? 'none' : 'flex' }}
                                      >
                                        <Package className="h-4 w-4 text-gray-400" />
                                      </div>
                                    </div>

                                    {/* Variant Info */}
                                    <div>
                                      <div className="text-sm font-medium">{variant.title}</div>
                                      <div className="text-xs text-gray-500">ID: {variant.id}</div>
                                      {variant.sku && <div className="text-xs text-gray-400">SKU: {variant.sku}</div>}
                                    </div>
                                  </div>
                                </TableCell>

                                {/* Base Cost */}
                                <TableCell>
                                  {existingProduct ? (
                                    <Input
                                      type="number"
                                      step="0.01"
                                      value={existingProduct.base_cost}
                                      onChange={(e) => {
                                        const newCost = parseFloat(e.target.value) || 0;
                                        const updatedConfig = {
                                          ...config,
                                          products: config.products.map(p =>
                                            p.variant_id === variant.id
                                              ? { ...p, base_cost: newCost }
                                              : p
                                          )
                                        };
                                        setConfig(updatedConfig);
                                        onUpdateCOGS?.(updatedConfig);
                                      }}
                                      className="w-24 text-sm"
                                    />
                                  ) : (
                                    <span className="text-gray-400 text-sm">Not added</span>
                                  )}
                                </TableCell>

                                {/* Overrides Summary */}
                                <TableCell>
                                  {existingProduct ? (
                                    <div className="flex flex-wrap gap-1">
                                      {existingProduct.overrides && existingProduct.overrides.length > 0 ? (
                                        existingProduct.overrides.map((override, idx) => (
                                          <Badge key={idx} variant="secondary" className="text-xs">
                                            {override.country} - {override.shipping_company}: ${override.cost}
                                          </Badge>
                                        ))
                                      ) : (
                                        <span className="text-gray-400 text-xs">No overrides</span>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-gray-400 text-sm">-</span>
                                  )}
                                </TableCell>

                                {/* Actions */}
                                <TableCell>
                                  {existingProduct ? (
                                    <div className="flex space-x-2">
                                      <Dialog>
                                        <DialogTrigger asChild>
                                          <Button size="sm" variant="outline">
                                            <Edit className="h-4 w-4 mr-2" />
                                            Manage Overrides
                                          </Button>
                                        </DialogTrigger>
                                        <DialogContent className="max-w-2xl">
                                          <DialogHeader>
                                            <DialogTitle>Manage Overrides for {variant.title}</DialogTitle>
                                            <DialogDescription>
                                              Set specific costs for different countries and shipping companies.
                                            </DialogDescription>
                                          </DialogHeader>

                                          <div className="space-y-4">
                                            <div className="grid grid-cols-4 gap-2 p-4 bg-gray-50 rounded-md">
                                              <div>
                                                <Label className="text-xs">Country</Label>
                                                <Select onValueChange={(val) => {
                                                  // This is just a temporary state for the "Add" row
                                                  // We'll implement a proper form state if needed, 
                                                  // but for now let's use a simple direct add approach
                                                  const select = document.getElementById(`country-select-${variant.id}`) as HTMLSelectElement;
                                                  if (select) select.value = val;
                                                }}>
                                                  <SelectTrigger id={`country-trigger-${variant.id}`}>
                                                    <SelectValue placeholder="Country" />
                                                  </SelectTrigger>
                                                  <SelectContent>
                                                    {COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                                  </SelectContent>
                                                </Select>
                                              </div>
                                              <div>
                                                <Label className="text-xs">Shipper</Label>
                                                <Select>
                                                  <SelectTrigger id={`shipper-trigger-${variant.id}`}>
                                                    <SelectValue placeholder="Shipper" />
                                                  </SelectTrigger>
                                                  <SelectContent>
                                                    {SHIPPING_COMPANIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                                  </SelectContent>
                                                </Select>
                                              </div>
                                              <div>
                                                <Label className="text-xs">Cost</Label>
                                                <Input id={`cost-input-${variant.id}`} type="number" step="0.01" placeholder="0.00" />
                                              </div>
                                              <div className="flex items-end">
                                                <Button
                                                  className="w-full"
                                                  onClick={() => {
                                                    // Get values from DOM elements (simplified for this inline implementation)
                                                    // In a real app, we'd use state, but this avoids creating 100s of state variables
                                                    const countryTrigger = document.getElementById(`country-trigger-${variant.id}`);
                                                    const shipperTrigger = document.getElementById(`shipper-trigger-${variant.id}`);
                                                    const costInput = document.getElementById(`cost-input-${variant.id}`) as HTMLInputElement;

                                                    const country = countryTrigger?.textContent;
                                                    const shipper = shipperTrigger?.textContent;
                                                    const cost = parseFloat(costInput?.value || '0');

                                                    if (!country || country === 'Country' || !shipper || shipper === 'Shipper' || !cost) {
                                                      toast({ title: "Error", description: "Please fill all fields", variant: "destructive" });
                                                      return;
                                                    }

                                                    const overrides = [...(existingProduct.overrides || [])];
                                                    const existingIdx = overrides.findIndex(o => o.country === country && o.shipping_company === shipper);

                                                    if (existingIdx >= 0) {
                                                      overrides[existingIdx].cost = cost;
                                                    } else {
                                                      overrides.push({ country, shipping_company: shipper, cost });
                                                    }

                                                    const updatedConfig = {
                                                      ...config,
                                                      products: config.products.map(p =>
                                                        p.variant_id === variant.id ? { ...p, overrides } : p
                                                      )
                                                    };
                                                    setConfig(updatedConfig);
                                                    onUpdateCOGS?.(updatedConfig);

                                                    // Clear input
                                                    if (costInput) costInput.value = '';
                                                  }}
                                                >
                                                  <Plus className="h-4 w-4 mr-2" /> Add
                                                </Button>
                                              </div>
                                            </div>

                                            <div className="border rounded-md">
                                              <Table>
                                                <TableHeader>
                                                  <TableRow>
                                                    <TableHead>Country</TableHead>
                                                    <TableHead>Shipper</TableHead>
                                                    <TableHead>Cost</TableHead>
                                                    <TableHead className="w-[50px]"></TableHead>
                                                  </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                  {existingProduct.overrides?.map((override, idx) => (
                                                    <TableRow key={idx}>
                                                      <TableCell>{override.country}</TableCell>
                                                      <TableCell>{override.shipping_company}</TableCell>
                                                      <TableCell>${override.cost}</TableCell>
                                                      <TableCell>
                                                        <Button
                                                          size="sm"
                                                          variant="ghost"
                                                          className="h-8 w-8 p-0 text-red-500"
                                                          onClick={() => {
                                                            const overrides = existingProduct.overrides?.filter((_, i) => i !== idx);
                                                            const updatedConfig = {
                                                              ...config,
                                                              products: config.products.map(p =>
                                                                p.variant_id === variant.id ? { ...p, overrides } : p
                                                              )
                                                            };
                                                            setConfig(updatedConfig);
                                                            onUpdateCOGS?.(updatedConfig);
                                                          }}
                                                        >
                                                          <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                      </TableCell>
                                                    </TableRow>
                                                  ))}
                                                  {(!existingProduct.overrides || existingProduct.overrides.length === 0) && (
                                                    <TableRow>
                                                      <TableCell colSpan={4} className="text-center text-gray-500 py-4">
                                                        No overrides configured
                                                      </TableCell>
                                                    </TableRow>
                                                  )}
                                                </TableBody>
                                              </Table>
                                            </div>
                                          </div>
                                        </DialogContent>
                                      </Dialog>

                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleDeleteProduct(variant.id)}
                                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => {
                                        const newProduct: ProductCog = {
                                          variant_id: variant.id,
                                          sku: variant.sku || '',
                                          base_cost: 0,
                                          overrides: []
                                        };
                                        const updatedConfig = {
                                          ...config,
                                          products: [...config.products, newProduct]
                                        };
                                        setConfig(updatedConfig);
                                        onUpdateCOGS?.(updatedConfig);
                                        toast({
                                          title: "Success",
                                          description: "Variant added to COGS",
                                        });
                                      }}
                                    >
                                      <Plus className="h-4 w-4 mr-2" />
                                      Add
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Save Button for Products Tab */}
          <div className="flex justify-end pt-4 border-t">
            <Button
              onClick={() => {
                debouncedSave(config);
                toast({
                  title: "Success",
                  description: "Products configuration saved to database",
                });
              }}
              className="bg-green-600 hover:bg-green-700"
            >
              <Save className="h-4 w-4 mr-2" />
              Save Products Configuration
            </Button>
          </div>

          {/* Edit Product Dialog */}
          <Dialog open={showEditProductDialog} onOpenChange={setShowEditProductDialog}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Product</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="editVariantId">Variant ID</Label>
                  <Input
                    id="editVariantId"
                    type="number"
                    value={newProduct.variant_id || ''}
                    onChange={(e) => setNewProduct(prev => ({ ...prev, variant_id: parseInt(e.target.value) || 0 }))}
                  />
                </div>
                <div>
                  <Label htmlFor="editSku">SKU (Optional)</Label>
                  <Input
                    id="editSku"
                    value={newProduct.sku || ''}
                    onChange={(e) => setNewProduct(prev => ({ ...prev, sku: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="editBaseCost">Base Cost</Label>
                  <Input
                    id="editBaseCost"
                    type="number"
                    step="0.01"
                    value={newProduct.base_cost || ''}
                    onChange={(e) => setNewProduct(prev => ({ ...prev, base_cost: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowEditProductDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleUpdateProduct}>
                    Update Product
                  </Button>
                </DialogFooter>
              </div>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="combos" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-semibold">Combos</h3>
            <Dialog open={showAddComboDialog} onOpenChange={setShowAddComboDialog}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Combo
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create New Combo</DialogTitle>
                  <DialogDescription>
                    Select products and set pricing rules for your combo. Any order containing the specified quantities will be treated as this combo.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-6">
                  {/* Basic Info */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="comboId">Combo ID</Label>
                      <Input
                        id="comboId"
                        placeholder="e.g., BUNDLE-2"
                        value={newCombo.combo_id || ''}
                        onChange={(e) => setNewCombo(prev => ({ ...prev, combo_id: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label htmlFor="comboName">Combo Name</Label>
                      <Input
                        id="comboName"
                        placeholder="e.g., 2-Pack Bundle"
                        value={newCombo.name || ''}
                        onChange={(e) => setNewCombo(prev => ({ ...prev, name: e.target.value }))}
                      />
                    </div>
                  </div>

                  {/* Product Selection */}
                  <div>
                    <Label className="text-base font-semibold">Select Products for Combo</Label>
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-80 overflow-y-auto border rounded-md p-3">
                      {products.length === 0 ? (
                        <div className="col-span-full text-center py-8">
                          <Package className="h-12 w-12 mx-auto text-gray-400 mb-2" />
                          <p className="text-sm text-gray-500">No products loaded. Click "Refresh Products" to load from Shopify.</p>
                        </div>
                      ) : (
                        products.map(product =>
                          product.variants.map((variant: any) => (
                            <div key={variant.id} className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-gray-50 hover:border-blue-300 transition-colors">
                              {/* Variant Image */}
                              <div className="flex-shrink-0">
                                {getVariantImage(variant.id) ? (
                                  <img
                                    src={getVariantImage(variant.id)!}
                                    alt={variant.title}
                                    className="w-12 h-12 object-cover rounded-md border"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none';
                                      e.currentTarget.nextElementSibling.style.display = 'flex';
                                    }}
                                  />
                                ) : null}
                                <div
                                  className="w-12 h-12 bg-gray-100 rounded-md border flex items-center justify-center"
                                  style={{ display: getVariantImage(variant.id) ? 'none' : 'flex' }}
                                >
                                  <Package className="h-6 w-6 text-gray-400" />
                                </div>
                              </div>

                              {/* Product Info */}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">
                                  {product.title}
                                </p>
                                <p className="text-xs text-gray-500 truncate">
                                  {variant.title}
                                </p>
                                {variant.sku && (
                                  <p className="text-xs text-gray-400 truncate">
                                    SKU: {variant.sku}
                                  </p>
                                )}
                              </div>

                              {/* Add Button */}
                              <div className="flex-shrink-0">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => addProductToCombo(variant.id)}
                                  className="h-8 w-8 p-0"
                                >
                                  <Plus className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          ))
                        )
                      )}
                    </div>
                  </div>

                  {/* Selected Products */}
                  {selectedProducts.length > 0 && (
                    <div>
                      <Label className="text-base font-semibold">Selected Products</Label>
                      <div className="mt-2 space-y-2">
                        {selectedProducts.map((product) => {
                          const productData = products.find(p => p.variants.some((v: any) => v.id === product.variant_id));
                          const variant = productData?.variants.find((v: any) => v.id === product.variant_id);

                          return (
                            <div key={product.variant_id} className="flex items-center space-x-3 p-3 border rounded-lg bg-blue-50">
                              {/* Variant Image */}
                              <div className="flex-shrink-0">
                                {getVariantImage(product.variant_id) ? (
                                  <img
                                    src={getVariantImage(product.variant_id)!}
                                    alt={variant?.title || 'Product'}
                                    className="w-10 h-10 object-cover rounded-md border"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none';
                                      e.currentTarget.nextElementSibling.style.display = 'flex';
                                    }}
                                  />
                                ) : null}
                                <div
                                  className="w-10 h-10 bg-gray-100 rounded-md border flex items-center justify-center"
                                  style={{ display: getVariantImage(product.variant_id) ? 'none' : 'flex' }}
                                >
                                  <Package className="h-5 w-5 text-gray-400" />
                                </div>
                              </div>

                              {/* Product Info */}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">
                                  {productData?.title}
                                </p>
                                <p className="text-xs text-gray-500 truncate">
                                  {variant?.title}
                                </p>
                                {variant?.sku && (
                                  <p className="text-xs text-gray-400 truncate">
                                    SKU: {variant.sku}
                                  </p>
                                )}
                              </div>

                              {/* Inline Quantity Edit */}
                              <div className="flex items-center space-x-2">
                                <Label className="text-sm text-gray-600">Qty:</Label>
                                <Input
                                  type="number"
                                  min="1"
                                  value={product.qty}
                                  onChange={(e) => updateProductQuantity(product.variant_id, parseInt(e.target.value) || 1)}
                                  className="w-16 h-8 text-sm"
                                />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => removeProductFromCombo(product.variant_id)}
                                  className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Pricing Rules */}
                  <div>
                    <Label className="text-base font-semibold">Pricing Rules</Label>
                    <div className="mt-2 grid grid-cols-3 gap-4">
                      <div>
                        <Label>Discount Type</Label>
                        <Select
                          value={comboDiscountType}
                          onValueChange={(value) => setComboDiscountType(value as 'percent' | 'fixed')}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="fixed">Fixed Amount ($)</SelectItem>
                            <SelectItem value="percent">Percentage (%)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Discount Value</Label>
                        <Input
                          type="number"
                          step="0.01"
                          placeholder={comboDiscountType === 'percent' ? '10' : '5.00'}
                          value={comboDiscountValue}
                          onChange={(e) => setComboDiscountValue(parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div>
                        <Label>Trigger Quantity</Label>
                        <Input
                          type="number"
                          min="1"
                          placeholder="2"
                          value={comboQuantity}
                          onChange={(e) => setComboQuantity(parseInt(e.target.value) || 1)}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Any {comboQuantity} product{comboQuantity !== 1 ? 's' : ''} from the selected list will trigger this combo
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Preview */}
                  {selectedProducts.length > 0 && (
                    <div className="p-4 bg-gray-50 rounded-md">
                      <Label className="text-base font-semibold">Combo Preview</Label>
                      <div className="mt-2 text-sm">
                        <p><strong>Combo ID:</strong> {newCombo.combo_id || 'Not set'}</p>
                        <p><strong>Name:</strong> {newCombo.name || 'Not set'}</p>
                        <p><strong>Products:</strong> {selectedProducts.length} product(s)</p>
                        <p><strong>Discount:</strong> {comboDiscountValue} {comboDiscountType === 'percent' ? '%' : '$'} off</p>
                        <p><strong>Trigger:</strong> Any {comboQuantity} product{comboQuantity !== 1 ? 's' : ''} from {selectedProducts.length} selected</p>
                      </div>
                    </div>
                  )}

                  <DialogFooter>
                    <Button variant="outline" onClick={() => {
                      setShowAddComboDialog(false);
                      setSelectedProducts([]);
                      setComboQuantity(1);
                      setComboDiscountType('fixed');
                      setComboDiscountValue(0);
                    }}>
                      Cancel
                    </Button>
                    <Button onClick={handleAddCombo} disabled={selectedProducts.length === 0}>
                      Create Combo
                    </Button>
                  </DialogFooter>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Combo ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Products</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>Trigger Qty</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {config.combos?.map((combo) => (
                <TableRow key={combo.combo_id}>
                  <TableCell className="font-mono">{combo.combo_id}</TableCell>
                  <TableCell className="font-medium">{combo.name}</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      {combo.items.map((item, index) => (
                        <div key={index} className="text-sm">
                          <Badge variant="outline" className="mr-1">
                            {getProductName(item.variant_id)}
                          </Badge>
                          <span className="text-gray-500">×{item.qty}</span>
                        </div>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      <Badge variant="secondary">
                        {combo.cogs_rule.discount_type === 'percent' ? '%' : '$'}
                      </Badge>
                      <span className="ml-1">
                        {combo.cogs_rule.discount_value || 0}
                        {combo.cogs_rule.discount_type === 'percent' ? '%' : ''}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      Any {combo.trigger_quantity || combo.items.reduce((sum, item) => sum + item.qty, 0)} from {combo.items.length} products
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEditCombo(combo)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteCombo(combo.combo_id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Edit Combo Dialog */}
          <Dialog open={showEditComboDialog} onOpenChange={setShowEditComboDialog}>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Edit Combo</DialogTitle>
                <DialogDescription>
                  Modify the products and pricing rules for this combo.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-6">
                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="editComboId">Combo ID</Label>
                    <Input
                      id="editComboId"
                      value={newCombo.combo_id || ''}
                      onChange={(e) => setNewCombo(prev => ({ ...prev, combo_id: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="editComboName">Combo Name</Label>
                    <Input
                      id="editComboName"
                      value={newCombo.name || ''}
                      onChange={(e) => setNewCombo(prev => ({ ...prev, name: e.target.value }))}
                    />
                  </div>
                </div>

                {/* Product Selection */}
                <div>
                  <Label className="text-base font-semibold">Select Products for Combo</Label>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-80 overflow-y-auto border rounded-md p-3">
                    {products.length === 0 ? (
                      <div className="col-span-full text-center py-8">
                        <Package className="h-12 w-12 mx-auto text-gray-400 mb-2" />
                        <p className="text-sm text-gray-500">No products loaded. Click "Refresh Products" to load from Shopify.</p>
                      </div>
                    ) : (
                      products.map(product =>
                        product.variants.map((variant: any) => (
                          <div key={variant.id} className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-gray-50 hover:border-blue-300 transition-colors">
                            {/* Variant Image */}
                            <div className="flex-shrink-0">
                              {getVariantImage(variant.id) ? (
                                <img
                                  src={getVariantImage(variant.id)!}
                                  alt={variant.title}
                                  className="w-12 h-12 object-cover rounded-md border"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                    e.currentTarget.nextElementSibling.style.display = 'flex';
                                  }}
                                />
                              ) : null}
                              <div
                                className="w-12 h-12 bg-gray-100 rounded-md border flex items-center justify-center"
                                style={{ display: getVariantImage(variant.id) ? 'none' : 'flex' }}
                              >
                                <Package className="h-6 w-6 text-gray-400" />
                              </div>
                            </div>

                            {/* Product Info */}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {product.title}
                              </p>
                              <p className="text-xs text-gray-500 truncate">
                                {variant.title}
                              </p>
                              {variant.sku && (
                                <p className="text-xs text-gray-400 truncate">
                                  SKU: {variant.sku}
                                </p>
                              )}
                            </div>

                            {/* Add Button */}
                            <div className="flex-shrink-0">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => addProductToCombo(variant.id)}
                                className="h-8 w-8 p-0"
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ))
                      )
                    )}
                  </div>
                </div>

                {/* Selected Products */}
                {selectedProducts.length > 0 && (
                  <div>
                    <Label className="text-base font-semibold">Selected Products</Label>
                    <div className="mt-2 space-y-2">
                      {selectedProducts.map((product) => {
                        const productData = products.find(p => p.variants.some((v: any) => v.id === product.variant_id));
                        const variant = productData?.variants.find((v: any) => v.id === product.variant_id);

                        return (
                          <div key={product.variant_id} className="flex items-center space-x-3 p-3 border rounded-lg bg-blue-50">
                            {/* Variant Image */}
                            <div className="flex-shrink-0">
                              {getVariantImage(product.variant_id) ? (
                                <img
                                  src={getVariantImage(product.variant_id)!}
                                  alt={variant?.title || 'Product'}
                                  className="w-10 h-10 object-cover rounded-md border"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                    e.currentTarget.nextElementSibling.style.display = 'flex';
                                  }}
                                />
                              ) : null}
                              <div
                                className="w-10 h-10 bg-gray-100 rounded-md border flex items-center justify-center"
                                style={{ display: getVariantImage(product.variant_id) ? 'none' : 'flex' }}
                              >
                                <Package className="h-5 w-5 text-gray-400" />
                              </div>
                            </div>

                            {/* Product Info */}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {productData?.title}
                              </p>
                              <p className="text-xs text-gray-500 truncate">
                                {variant?.title}
                              </p>
                              {variant?.sku && (
                                <p className="text-xs text-gray-400 truncate">
                                  SKU: {variant.sku}
                                </p>
                              )}
                            </div>

                            {/* Inline Quantity Edit */}
                            <div className="flex items-center space-x-2">
                              <Label className="text-sm text-gray-600">Qty:</Label>
                              <Input
                                type="number"
                                min="1"
                                value={product.qty}
                                onChange={(e) => updateProductQuantity(product.variant_id, parseInt(e.target.value) || 1)}
                                className="w-16 h-8 text-sm"
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => removeProductFromCombo(product.variant_id)}
                                className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Pricing Rules */}
                <div>
                  <Label className="text-base font-semibold">Pricing Rules</Label>
                  <div className="mt-2 grid grid-cols-3 gap-4">
                    <div>
                      <Label>Discount Type</Label>
                      <Select
                        value={comboDiscountType}
                        onValueChange={(value) => setComboDiscountType(value as 'percent' | 'fixed')}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fixed">Fixed Amount ($)</SelectItem>
                          <SelectItem value="percent">Percentage (%)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Discount Value</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={comboDiscountValue}
                        onChange={(e) => setComboDiscountValue(parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div>
                      <Label>Trigger Quantity</Label>
                      <Input
                        type="number"
                        min="1"
                        value={comboQuantity}
                        onChange={(e) => setComboQuantity(parseInt(e.target.value) || 1)}
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Any {comboQuantity} product{comboQuantity !== 1 ? 's' : ''} from the selected list will trigger this combo
                      </p>
                    </div>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => {
                    setShowEditComboDialog(false);
                    setSelectedProducts([]);
                    setComboQuantity(1);
                    setComboDiscountType('fixed');
                    setComboDiscountValue(0);
                  }}>
                    Cancel
                  </Button>
                  <Button onClick={handleUpdateCombo} disabled={selectedProducts.length === 0}>
                    Update Combo
                  </Button>
                </DialogFooter>
              </div>
            </DialogContent>
          </Dialog>
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
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Type</Label>
                    <Select value={calcType} onValueChange={(value: 'product' | 'combo') => setCalcType(value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="product">Product</SelectItem>
                        <SelectItem value="combo">Combo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Country</Label>
                    <Select value={calcCountry} onValueChange={setCalcCountry}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COUNTRIES.map(country => (
                          <SelectItem key={country} value={country}>{country}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Shipping Company</Label>
                    <Select value={calcShipper} onValueChange={setCalcShipper}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SHIPPING_COMPANIES.map(company => (
                          <SelectItem key={company} value={company}>{company}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Quantity</Label>
                    <Input
                      type="number"
                      min="1"
                      value={calcQuantity}
                      onChange={(e) => setCalcQuantity(parseInt(e.target.value) || 1)}
                    />
                  </div>
                </div>

                {calcType === 'product' ? (
                  <div>
                    <Label>Select Product Variant</Label>
                    <Select
                      value={calcVariantId.toString()}
                      onValueChange={(value) => setCalcVariantId(parseInt(value))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a product variant" />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map(product =>
                          product.variants.map((variant: any) => (
                            <SelectItem key={variant.id} value={variant.id.toString()}>
                              {product.title} - {variant.title} ({variant.sku || 'No SKU'})
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div>
                    <Label>Combo ID</Label>
                    <Select value={calcComboId} onValueChange={setCalcComboId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select combo" />
                      </SelectTrigger>
                      <SelectContent>
                        {config.combos?.map(combo => (
                          <SelectItem key={combo.combo_id} value={combo.combo_id}>
                            {combo.name} ({combo.combo_id})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <Button onClick={handleCalculate} className="w-full">
                  <Calculator className="h-4 w-4 mr-2" />
                  Calculate COGS
                </Button>

                {calculatorResult && (
                  <div className="bg-green-50 p-4 rounded-lg">
                    <h4 className="font-semibold text-green-800 mb-2">Calculation Result</h4>
                    <div className="space-y-1 text-sm">
                      <div>Unit Cost: ${calculatorResult.unit_cost.toFixed(2)}</div>
                      <div>Total Cost: ${calculatorResult.total_cost.toFixed(2)}</div>
                      <div>Method: {calculatorResult.calculation_method}</div>
                      {calculatorResult.applied_discount && (
                        <div>
                          Discount: {calculatorResult.applied_discount.type} {calculatorResult.applied_discount.value}
                          {calculatorResult.applied_discount.type === 'percent' ? '%' : '$'}
                          (${calculatorResult.applied_discount.amount.toFixed(2)})
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* JSON Editor Dialog */}
      <Dialog open={showJsonEditor} onOpenChange={setShowJsonEditor}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Edit COGS Configuration (JSON)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              className="min-h-[400px] font-mono text-sm"
              placeholder="Enter JSON configuration..."
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowJsonEditor(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveConfig}>
                <Save className="h-4 w-4 mr-2" />
                Save Configuration
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
