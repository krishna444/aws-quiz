FROM node:20-alpine

# Set working directory inside the container
WORKDIR /app

# Copy package files first to leverage Docker layer caching
COPY package*.json ./

# Install dependencies if present (or serve directly via npx)
RUN npm ci --only=production || true

# Copy static assets and exam data from the root build context
COPY quiz.html /app/index.html
COPY exams/ /app/exams/

# Install serve globally or execute via npx
EXPOSE 3000

CMD ["npx", "serve", "-s", ".", "-l", "3000"]