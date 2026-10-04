const IS_PROD = import.meta.env.PROD;

const server = IS_PROD
  ? "https://video-call-bc.onrender.com"
  : "http://localhost:8080";

export { IS_PROD, server };