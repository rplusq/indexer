/* eslint-disable @typescript-eslint/no-explicit-any */

import { Request, RouteOptions } from "@hapi/hapi";
import Joi from "joi";
import * as Boom from "@hapi/boom";
import { logger } from "@/common/logger";
import { ApiKeyManager } from "@/models/api-keys";
import _ from "lodash";
import { idb } from "@/common/db";
import {
  ActionsLogContext,
  ActionsLogOrigin,
  actionsLogJob,
} from "@/jobs/general-tracking/actions-log-job";

const version = "v1";

export const postNsfwStatusCollectionV1Options: RouteOptions = {
  description: "Update collections nsfw status",
  notes: "This API can be used by allowed API keys to update the nsfw status of a collection.",
  tags: ["api", "Management"],
  plugins: {
    "hapi-swagger": {
      order: 13,
    },
  },
  timeout: {
    server: 2 * 60 * 1000,
  },
  validate: {
    headers: Joi.object({
      "x-api-key": Joi.string().required(),
    }).options({ allowUnknown: true }),
    payload: Joi.object({
      collections: Joi.alternatives()
        .try(
          Joi.array()
            .items(Joi.string().lowercase())
            .min(1)
            .max(50)
            .description(
              "Update to one or more collections. Max limit is 50. Example: `0x8d04a8c79ceb0889bdd12acdf3fa9d207ed3ff63`"
            ),
          Joi.string()
            .lowercase()
            .description(
              "Update to one or more collections. Max limit is 50. Example: `0x8d04a8c79ceb0889bdd12acdf3fa9d207ed3ff63`"
            )
        )
        .required(),
      nsfw: Joi.boolean()
        .description("API to update the nsfw status of a collection")
        .default(true),
    }),
  },
  response: {
    schema: Joi.object({
      message: Joi.string(),
    }).label(`postNsfwStatusCollection${version.toUpperCase()}Response`),
    failAction: (_request, _h, error) => {
      logger.error(
        `post-nsfw-status-collection-${version}-handler`,
        `Wrong response schema: ${error}`
      );
      throw error;
    },
  },
  handler: async (request: Request) => {
    const payload = request.payload as any;
    let updateResult;

    try {
      const apiKey = await ApiKeyManager.getApiKey(request.headers["x-api-key"]);

      if (_.isNull(apiKey)) {
        throw Boom.unauthorized("Invalid API key");
      }

      if (!apiKey.permissions?.update_nsfw_status) {
        throw Boom.unauthorized("Not allowed");
      }

      if (!_.isArray(payload.collections)) {
        payload.collections = [payload.collections];
      }

      const newNsfwStatus = Number(payload.nsfw) ? 100 : -100;

      updateResult = await idb.manyOrNone(
        `
            UPDATE collections
            SET
              nsfw_status = $/nsfwStatus/,
              updated_at = now()
            WHERE id IN ($/ids:list/)
            AND nsfw_status IS DISTINCT FROM $/nsfwStatus/
            RETURNING id
          `,
        {
          ids: payload.collections,
          nsfwStatus: newNsfwStatus,
        }
      );

      if (updateResult) {
        // Track the change
        await actionsLogJob.addToQueue(
          updateResult.map((res) => ({
            context: ActionsLogContext.NsfwCollectionUpdate,
            origin: ActionsLogOrigin.API,
            actionTakerIdentifier: apiKey.key,
            collection: res.id,
            data: {
              newNsfwStatus,
            },
          }))
        );
      }

      return {
        message: `Update nsfw status for collections ${JSON.stringify(
          payload.collections
        )} request accepted`,
      };
    } catch (error) {
      logger.error(`post-nsfw-status-collection-${version}-handler`, `Handler failure: ${error}`);
      throw error;
    }
  },
};
