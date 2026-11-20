import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Em desenvolvimento, o Vite encaminha o Socket.io para o servidor (porta 3001).
// Assim o cliente usa sempre a mesma origem e não precisa de CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // permite abrir pelo IP da rede (outros dispositivos)
    port: 5173,
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
});
