/* eslint-disable no-console */
export const info = (message?: any, ...optionalParams: any[]) => {
    console.info(message, ...optionalParams);
}
export const errorLog = (message?: any, ...optionalParams: any[]) => {
    console.error(message, ...optionalParams);
}
export const debug = (message?: any, ...optionalParams: any[]) => {
    if (process.env.DEBUG === undefined) {
        return;
    }
    console.debug(message, ...optionalParams);
}

export const createLogger = (name: string) => {
    return {
        info: (message?: any, ...optionalParams: any[]) => {
            info(`[${name}]`, message, ...optionalParams);
        },
        error: (message?: any, ...optionalParams: any[]) => {
            errorLog(`[${name}]`, message, ...optionalParams);
        },
        debug: (message?: any, ...optionalParams: any[]) => {
            debug(`[${name}]`, message, ...optionalParams);
        }
    }
}
