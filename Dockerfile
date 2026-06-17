FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Placeholder env vars so the server starts for build/healthcheck tests.
# Override at runtime with WALLET_ADDRESS set to the real funded wallet.
ENV WALLET_ADDRESS=0x0000000000000000000000000000000000000000 \
    X402_NETWORK=base-sepolia \
    FACILITATOR_URL=https://x402.org/facilitator \
    PORT=4021

EXPOSE 4021

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const h=require('http');h.get('http://localhost:4021/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "src/server.js"]
