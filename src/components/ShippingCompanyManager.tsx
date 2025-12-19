import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Plus, Edit, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ShippingCompany {
    id: string;
    name: string;
    display_name: string;
    tracking_prefixes?: string;
    is_active: boolean;
}

export const ShippingCompanyManager: React.FC = () => {
    const [companies, setCompanies] = useState<ShippingCompany[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [showEditDialog, setShowEditDialog] = useState(false);
    const [editingCompany, setEditingCompany] = useState<ShippingCompany | null>(null);
    const [formData, setFormData] = useState({ name: '', display_name: '', tracking_prefixes: '' });
    const { toast } = useToast();

    useEffect(() => {
        loadCompanies();
    }, []);

    const loadCompanies = async () => {
        try {
            setIsLoading(true);
            const apiBaseUrl = '/api';
            const response = await fetch(`${apiBaseUrl}/cogs/shipping-companies`);

            if (response.ok) {
                const data = await response.json();
                setCompanies(data);
            } else {
                toast({
                    title: 'Error',
                    description: 'Failed to load shipping companies',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error loading shipping companies:', error);
            toast({
                title: 'Error',
                description: 'Failed to load shipping companies',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleAdd = async () => {
        if (!formData.name) {
            toast({
                title: 'Error',
                description: 'Name is required',
                variant: 'destructive',
            });
            return;
        }

        try {
            const apiBaseUrl = '/api';
            const response = await fetch(`${apiBaseUrl}/cogs/shipping-companies`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });

            if (response.ok) {
                toast({
                    title: 'Success',
                    description: 'Shipping company added successfully',
                });
                setShowAddDialog(false);
                setFormData({ name: '', display_name: '', tracking_prefixes: '' });
                loadCompanies();
            } else {
                toast({
                    title: 'Error',
                    description: 'Failed to add shipping company',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error adding shipping company:', error);
            toast({
                title: 'Error',
                description: 'Failed to add shipping company',
                variant: 'destructive',
            });
        }
    };

    const handleEdit = async () => {
        if (!editingCompany || !formData.name) {
            toast({
                title: 'Error',
                description: 'Name is required',
                variant: 'destructive',
            });
            return;
        }

        try {
            const apiBaseUrl = '/api';
            const response = await fetch(`${apiBaseUrl}/cogs/shipping-companies/${editingCompany.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });

            if (response.ok) {
                toast({
                    title: 'Success',
                    description: 'Shipping company updated successfully',
                });
                setShowEditDialog(false);
                setEditingCompany(null);
                setFormData({ name: '', display_name: '', tracking_prefixes: '' });
                loadCompanies();
            } else {
                toast({
                    title: 'Error',
                    description: 'Failed to update shipping company',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error updating shipping company:', error);
            toast({
                title: 'Error',
                description: 'Failed to update shipping company',
                variant: 'destructive',
            });
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this shipping company?')) {
            return;
        }

        try {
            const apiBaseUrl = '/api';
            const response = await fetch(`${apiBaseUrl}/cogs/shipping-companies/${id}`, {
                method: 'DELETE',
            });

            if (response.ok) {
                toast({
                    title: 'Success',
                    description: 'Shipping company deleted successfully',
                });
                loadCompanies();
            } else {
                toast({
                    title: 'Error',
                    description: 'Failed to delete shipping company',
                    variant: 'destructive',
                });
            }
        } catch (error) {
            console.error('Error deleting shipping company:', error);
            toast({
                title: 'Error',
                description: 'Failed to delete shipping company',
                variant: 'destructive',
            });
        }
    };

    const openEditDialog = (company: ShippingCompany) => {
        setEditingCompany(company);
        setFormData({
            name: company.name,
            display_name: company.display_name,
            tracking_prefixes: company.tracking_prefixes || '',
        });
        setShowEditDialog(true);
    };

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Shipping Companies</CardTitle>
                <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                    <DialogTrigger asChild>
                        <Button>
                            <Plus className="h-4 w-4 mr-2" />
                            Add Shipping Company
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Add Shipping Company</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div>
                                <Label htmlFor="name">Name *</Label>
                                <Input
                                    id="name"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="e.g., DHL, FedEx"
                                />
                            </div>
                            <div>
                                <Label htmlFor="display_name">Display Name</Label>
                                <Input
                                    id="display_name"
                                    value={formData.display_name}
                                    onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                                    placeholder="Optional display name"
                                />
                            </div>
                            <div>
                                <Label htmlFor="tracking_prefixes">Tracking Prefixes</Label>
                                <Input
                                    id="tracking_prefixes"
                                    value={formData.tracking_prefixes}
                                    onChange={(e) => setFormData({ ...formData, tracking_prefixes: e.target.value })}
                                    placeholder="e.g., YT,YUN,YTCN (comma-separated)"
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                    Enter tracking number prefixes separated by commas
                                </p>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleAdd}>Add</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </CardHeader>
            <CardContent>
                {isLoading ? (
                    <div className="text-center py-8">Loading...</div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Display Name</TableHead>
                                <TableHead>Tracking Prefixes</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {companies.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                                        No shipping companies found. Click "Add Shipping Company" to create one.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                companies.map((company) => (
                                    <TableRow key={company.id}>
                                        <TableCell className="font-medium">{company.name}</TableCell>
                                        <TableCell>{company.display_name}</TableCell>
                                        <TableCell className="text-sm text-muted-foreground">{company.tracking_prefixes || '-'}</TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => openEditDialog(company)}
                                            >
                                                <Edit className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleDelete(company.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                )}

                {/* Edit Dialog */}
                <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Edit Shipping Company</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div>
                                <Label htmlFor="edit-name">Name *</Label>
                                <Input
                                    id="edit-name"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                />
                            </div>
                            <div>
                                <Label htmlFor="edit-display-name">Display Name</Label>
                                <Input
                                    id="edit-display-name"
                                    value={formData.display_name}
                                    onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
                                />
                            </div>
                            <div>
                                <Label htmlFor="edit-tracking-prefixes">Tracking Prefixes</Label>
                                <Input
                                    id="edit-tracking-prefixes"
                                    value={formData.tracking_prefixes}
                                    onChange={(e) => setFormData({ ...formData, tracking_prefixes: e.target.value })}
                                    placeholder="e.g., YT,YUN,YTCN (comma-separated)"
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                    Enter tracking number prefixes separated by commas
                                </p>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleEdit}>Save Changes</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
};
