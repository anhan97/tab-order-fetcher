import { Store, StoreCreateRequest } from '@/types/user';
import { v4 as uuidv4 } from 'uuid';

class StoreService {
  private stores: Map<string, Store> = new Map();

  async createStore(userId: string, request: StoreCreateRequest): Promise<Store> {
    const store: Store = {
      id: uuidv4(),
      userId,
      name: request.name,
      shopifyConfig: request.shopifyConfig,
      facebookConfigs: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.stores.set(store.id, store);
    return store;
  }

  async getStoresByUser(userId: string): Promise<Store[]> {
    return Array.from(this.stores.values()).filter(store => store.userId === userId);
  }

  async getStoreById(storeId: string): Promise<Store | null> {
    return this.stores.get(storeId) || null;
  }

  async updateStore(storeId: string, updates: Partial<Store>): Promise<Store | null> {
    const store = this.stores.get(storeId);
    if (!store) return null;

    const updatedStore = {
      ...store,
      ...updates,
      updatedAt: new Date()
    };

    this.stores.set(storeId, updatedStore);
    return updatedStore;
  }

  async deleteStore(storeId: string): Promise<boolean> {
    return this.stores.delete(storeId);
  }

  async addFacebookConfig(storeId: string, config: { accessToken: string; adAccountId: string; name: string }): Promise<Store | null> {
    const store = this.stores.get(storeId);
    if (!store) return null;

    const facebookConfig = {
      id: uuidv4(),
      ...config
    };

    const updatedStore = {
      ...store,
      facebookConfigs: [...store.facebookConfigs, facebookConfig],
      updatedAt: new Date()
    };

    this.stores.set(storeId, updatedStore);
    return updatedStore;
  }

  async removeFacebookConfig(storeId: string, configId: string): Promise<Store | null> {
    const store = this.stores.get(storeId);
    if (!store) return null;

    const updatedStore = {
      ...store,
      facebookConfigs: store.facebookConfigs.filter(config => config.id !== configId),
      updatedAt: new Date()
    };

    this.stores.set(storeId, updatedStore);
    return updatedStore;
  }

  async updateFacebookConfig(storeId: string, configId: string, updates: Partial<{ accessToken: string; adAccountId: string; name: string }>): Promise<Store | null> {
    const store = this.stores.get(storeId);
    if (!store) return null;

    const updatedStore = {
      ...store,
      facebookConfigs: store.facebookConfigs.map(config => 
        config.id === configId ? { ...config, ...updates } : config
      ),
      updatedAt: new Date()
    };

    this.stores.set(storeId, updatedStore);
    return updatedStore;
  }
}

export const storeService = new StoreService(); 