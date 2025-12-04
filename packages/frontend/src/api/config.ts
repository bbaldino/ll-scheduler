// API configuration
// In development, Vite proxies /api to the backend server
// In production, we need the full URL to the Cloudflare Worker

export const API_BASE = import.meta.env.VITE_API_URL || '/api';
