import { makeHandler } from "./identify.js";

export default makeHandler("https://crop.kindwise.com/api/v1/identification", "CROP_HEALTH_API_KEY");

export const config = { api: { bodyParser: { sizeLimit: "12mb" } } };
