FROM node:alpine

# Defined the name of the argument that can be passed on the command line 
# later on when running docker build: `docker build --build-arg FUNC_NAME=hello`
ARG FUNC_NAME

# Create app directory
WORKDIR /usr/src/app

# Copy the generated files into the container
COPY ${FUNC_NAME}/* ./
COPY function/* ./

# Install app dependencies
# If you are building your code for production
# RUN npm ci --only=production
RUN npm install

EXPOSE 8000

CMD [ "node", "server.js" ]