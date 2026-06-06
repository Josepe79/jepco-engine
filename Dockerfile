# Use Node 20 as base
FROM node:20-slim AS builder

# Set working directory
WORKDIR /app

# Install openssl for Prisma
RUN apt-get update -y && apt-get install -y openssl

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm install

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY . .

# Build step (if any, but we are using plain JS)

# Final stage
FROM node:20-slim
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl
COPY --from=builder /app /app

# Expose port
EXPOSE 3000

# Start command
CMD ["npm", "start"]
