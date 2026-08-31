import { handleVercelApi } from "../server/vercelApi.js";

export default {
  fetch(request) {
    return handleVercelApi(request);
  },
};
