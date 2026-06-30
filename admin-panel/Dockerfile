FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

EXPOSE 5173

# Run the Vite development server on all network interfaces
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
