/**
 * Storage abstraction for Murmur songs
 *
 * Local Creator → LocalStorageAdapter (browser storage)
 * Google User → CloudStorageAdapter (API + database)
 */

export interface Song {
  id: string;
  userId: string;
  title: string;
  // Opaque payloads at this layer — adapters persist them without reading.
  melody: unknown;
  arrangement: unknown;
  createdAt: string;
  updatedAt: string;
  // ... other song fields
}

export interface StorageAdapter {
  saveSong(song: Song): Promise<void>;
  getSongs(): Promise<Song[]>;
  getSong(id: string): Promise<Song | null>;
  deleteSong(id: string): Promise<void>;
  updateSong(id: string, updates: Partial<Song>): Promise<void>;
}

/**
 * Local storage adapter - uses IndexedDB for Local Creator
 * Data stays on device, not uploaded to cloud
 */
export class LocalStorageAdapter implements StorageAdapter {
  private dbName = "murmur-local";
  private storeName = "songs";
  private db: IDBDatabase | null = null;

  private async openDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
      };
    });
  }

  async saveSong(song: Song): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      const request = store.put(song);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getSongs(): Promise<Song[]> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async getSong(id: string): Promise<Song | null> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const store = tx.objectStore(this.storeName);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteSong(id: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async updateSong(id: string, updates: Partial<Song>): Promise<void> {
    const existing = await this.getSong(id);
    if (!existing) throw new Error("Song not found");

    const updated = { ...existing, ...updates, updatedAt: new Date().toISOString() };
    await this.saveSong(updated);
  }
}

/**
 * Cloud storage adapter - uses API for Google users
 * Data uploaded to cloud database, synced across devices
 */
export class CloudStorageAdapter implements StorageAdapter {
  async saveSong(song: Song): Promise<void> {
    const response = await fetch("/api/songs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(song),
    });

    if (!response.ok) {
      throw new Error(`Failed to save song: ${response.statusText}`);
    }
  }

  async getSongs(): Promise<Song[]> {
    const response = await fetch("/api/songs");
    if (!response.ok) {
      throw new Error(`Failed to fetch songs: ${response.statusText}`);
    }
    return response.json();
  }

  async getSong(id: string): Promise<Song | null> {
    const response = await fetch(`/api/songs/${id}`);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Failed to fetch song: ${response.statusText}`);
    }
    return response.json();
  }

  async deleteSong(id: string): Promise<void> {
    const response = await fetch(`/api/songs/${id}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error(`Failed to delete song: ${response.statusText}`);
    }
  }

  async updateSong(id: string, updates: Partial<Song>): Promise<void> {
    const response = await fetch(`/api/songs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      throw new Error(`Failed to update song: ${response.statusText}`);
    }
  }
}

/**
 * Factory to get the correct storage adapter based on auth state
 */
export function getStorageAdapter(isGoogleUser: boolean): StorageAdapter {
  return isGoogleUser ? new CloudStorageAdapter() : new LocalStorageAdapter();
}
