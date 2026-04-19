import { Router } from 'express';

export const projectsRouter = Router();

projectsRouter.post('/', (request, response) => {
  const {
    name,
    siteName,
    siteUrl,
    siteDescription,
    sellingPoints,
  } = request.body ?? {};

  response.status(201).json({
    project: {
      id: 1,
      name,
      siteName,
      siteUrl,
      siteDescription,
      sellingPoints,
    },
  });
});
