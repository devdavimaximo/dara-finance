# Imagem única: o front (React/Vite) é compilado e servido pela API ASP.NET Core, na mesma origem.

# ---- Front ----
FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- Back ----
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS server
WORKDIR /src
COPY Finances.Server/Finances.Server.csproj Finances.Server/
RUN dotnet restore Finances.Server/Finances.Server.csproj
COPY Finances.Server/ Finances.Server/
RUN dotnet publish Finances.Server/Finances.Server.csproj -c Release -o /app --no-restore

# ---- Runtime ----
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_HTTP_PORTS=8080 \
    DATA_DIR=/data \
    TZ=America/Sao_Paulo
COPY --from=server /app ./
COPY --from=web /src/web/dist ./wwwroot
RUN mkdir -p /data && chown $APP_UID /data
VOLUME /data
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "Finances.Server.dll"]
