import { Request, Response, NextFunction, RequestHandler } from 'express'
import {
    dbError,
    HttpError,
    HttpStatusCode,
    MethodNotAllowed,
    NotFound,
} from './httpErrors'
import logger from '@self/logging/logger'
import {
    BaseError,
    ForeignKeyConstraintError,
    TimeoutError,
    UniqueConstraintError,
} from 'sequelize'

/**
 * @desc Centralized error handling middleware
 * @async
 * @method handleError
 * @method isTrustedError
 * @class ErrorHandler
 */
class ErrorHandler {
    public handleError(err: Error, res?: Response) {
        //   await sendMailToAdminIfCritical();
        //   await sendEventsToSentry();

        if (err instanceof HttpError) {
            logger.warn(`HttpError ${err.httpCode}: ${err}`)
            res?.status(err.httpCode).json(err)
        }

        if (!res?.headersSent) {
            logger.error(`Server error: ${err}`)
            res?.status(500).json(err)
        }
    }

    public isTrustedError(error: Error): boolean {
        if (error instanceof HttpError) {
            return error.isOperational
        }
        return false
    }
}

/**
 * @desc Handles not allowed http methods
 * @param {Request} request
 * @param {Response} response
 * @param {NextFunction} next
 * @returns {Object} - The NotAllowedMethod Object
 * @exports allowedHttpMethods
 */
export const allowedHttpMethods =
    (methods: string[]): RequestHandler =>
    (request: Request, response: Response, next: NextFunction): void => {
        if (!methods.includes(request.method)) {
            const msg = `${request.method.toString()} request is not allowed at ${request.originalUrl.toString()}`
            logger.warn(msg)
            return next(
                new MethodNotAllowed(
                    {
                        msg: msg,
                    },
                    true
                )
            )
        }

        return next()
    }

/**
 * @desc Handles database errors
 * @param {Error} error
 * @param {Request} request
 * @param {Response} response
 * @param {NextFunction} next
 * @returns {dbError || Error}
 * @exports DatabaseErrorHandler
 */
export const DatabaseErrorHandler = (
    error: Error,
    request: Request,
    response: Response,
    next: NextFunction
): void => {
    logger.error(`DatabaseErrorHandler: ${error.message}`)
    if (error instanceof TimeoutError) {
        return next(
            new dbError(
                HttpStatusCode.GATEWAY_TIMEOUT,
                { message: error.message },
                true
            )
        )
    } else if (error instanceof UniqueConstraintError) {
        return next(
            new dbError(
                HttpStatusCode.CONFLICT,
                {
                    message: error.message,
                    errors: error.errors,
                    fields: error.fields,
                },
                true
            )
        )
    } else if (error instanceof ForeignKeyConstraintError) {
        return next(
            new dbError(
                HttpStatusCode.INTERNAL_SERVER,
                {
                    message: error.message,
                    fields: error.fields,
                    table: error.table,
                    value: error.value,
                    index: error.index,
                },
                true
            )
        )
    } else if (error instanceof BaseError) {
        return next(
            new dbError(
                HttpStatusCode.INTERNAL_SERVER,
                {
                    message: error.message,
                },
                true
            )
        )
    }

    return next(error)
}

/**
 * @desc Handles the 404 undefined routes
 * @async
 * @param {Request} request
 * @param {Response} response
 * @param {NextFunction} next
 * @returns {Object} - The NotFound Object
 * @exports notFoundHandler
 */
export const notFoundHandler = (
    error: Error,
    request: Request,
    response: Response,
    next: NextFunction
): any => {
    // new instance of NotFound Error object
    const notFound = new NotFound({ path: request.path.toString() }, true)

    // This is to avoid the error `Headers already sent` error
    if (response.headersSent) {
        return next()
    }

    // Log the 404 as an operational error
    logger.info(`Error 404. Cannot find ${request.path.toString()} route.`)

    return response.status(404).json(notFound)
}

/**
 * @async
 * @desc Checks if the error is operational
 * @param {Error} err
 * @param {Request} req
 * @param {Response} res
 * @param {NextFunction} next
 * @returns {Object} - The error object
 * @exports trustedError
 */
export const trustedError = (
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction
): any => {
    const trusted = errorHandler.isTrustedError(err)
    const info: string = trusted
        ? ((err as HttpError).error as string)
        : err.message

    logger.error(
        JSON.stringify({
            from: 'Error message from the centralized error-handling component.',
            info,
            name: err.name,
            stack: err.stack,
        })
    )

    if (!trusted) {
        return next(err)
    }
    return errorHandler.handleError(err, res)
}

/**
 * @desc If a promise throws an error then use this middleware
 * @param {Error} reason
 * @param {Promise<any>} promise
 * @throws {reason}
 * @exports unhandledRejection
 */
export const unhandledRejection = (
    reason: Error,
    promise: Promise<any>
): void => {
    logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`)
    //throw reason
}

process.on('unhandledRejection', unhandledRejection)

/**
 * @desc If error non operational then crash the app
 * @param {Error} error
 * @exports uncaughtException
 */
export const uncaughtException = (error: Error): void => {
    logger.error(error)
    errorHandler.handleError(error)
    if (!errorHandler.isTrustedError(error)) {
        process.exit(1) // Crash the app if fatal error

        // If a graceful shutdown is not achieved after 1 second,
        // shut down the process completely
        setTimeout(() => {
            process.abort() // exit immediately and generate a core dump file
        }, 1000).unref()
    }
}

/**
 * @desc exports an instance of the ErrorHandler object
 * @exports errorHandler
 */
export const errorHandler = new ErrorHandler()
