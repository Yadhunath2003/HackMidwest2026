FROM node:22-alpine

WORKDIR /app

# Dependencies first so this layer is cached until the lockfile changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Next.js bakes the /api proxy target into the build, so it is a build argument.
ARG BACKEND_URL=http://backend:8000
ENV BACKEND_URL=$BACKEND_URL
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
