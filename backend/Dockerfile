FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

# Generate Prisma Client
RUN npx prisma generate

COPY . .

RUN npm run build

# Expose port
EXPOSE 3000

# Start script: Push schema, seed the DB, then start the server
# (Errors in seed are ignored so it doesn't crash if already seeded)
CMD npx prisma db push --accept-data-loss && (npm run db:seed || true) && npm start
