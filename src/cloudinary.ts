import { v2 as cloudinary } from "cloudinary";

type CloudinaryCredentials = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
};

function getCredentials(): CloudinaryCredentials {
  const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } =
    process.env;
  if (!cloudName || !apiKey || !apiSecret) {
    throw Object.assign(
      new Error(
        "CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET must be configured.",
      ),
      { status: 503 },
    );
  }
  return { cloudName, apiKey, apiSecret };
}

export function createCloudinaryUploadSignature(
  folder: string,
  timestamp = Math.floor(Date.now() / 1000),
) {
  const { cloudName, apiKey, apiSecret } = getCredentials();
  const parameters = { folder, timestamp };
  return {
    cloudName,
    apiKey,
    folder,
    timestamp,
    signature: cloudinary.utils.api_sign_request(parameters, apiSecret),
  };
}

export function configureCloudinary() {
  const credentials = getCredentials();
  cloudinary.config({
    cloud_name: credentials.cloudName,
    api_key: credentials.apiKey,
    api_secret: credentials.apiSecret,
    secure: true,
  });
  return cloudinary;
}
