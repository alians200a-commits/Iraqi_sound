FROM node:22-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json ./
COPY server.mjs sawtak-arabi.mjs ./
COPY public ./public
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]
