/**
 * Простой класс-обертка на JavaScript для стандартной JS-библиотеки Битрикс24,
 * позволяющая избежать ада колбеков и работать c асинхронными функциями
 * и асинхронными генераторами ECMAScript 9.
 *
 * @author    andrey-tech
 * @copyright 2019-2023 andrey-tech
 * @link      https://github.com/andrey-tech/bx24-wrapper-js
 * @license   MIT
 *
 * @version 1.5.1
 *
 * v1.0.0 (01.12.2019) Начальный релиз
 * v1.1.0 (28.05.2020) Рефакторинг
 * v1.2.0 (02.06.2020) Удален метод init()
 * v1.3.0 (03.06.2020) Добавлен метод getLastResult()
 * v1.4.0 (03.06.2020) Добавлен метод createCalls()
 * v1.4.1 (14.06.2020) Параметр throttle исправлен на 2
 * v1.4.2 (14.02.2021) Рефакторинг
 * v1.5.0 (11.03.2023) Добавлен параметр dataExtractor в методы класса, рефакторинг
 * v1.5.1 (06.08.2023) Исправлено поведение метода callBatch() при возникновении ошибки, рефакторинг
 */

/* jshint esversion: 9 */

class BX24Wrapper {

    /**
     * Конструктор
     */
    constructor() {

        /**
         * Проверка загрузки стандартной библиотеки Битрикс24.
         * <script src="//api.bitrix24.com/api/v1/"></script>
         */
        if (! window.BX.rest) {
            throw "Can't find BX24 libary! See https://dev.1c-bitrix.ru/rest_help/js_library/index.php";
        }

        /**
         * Максимальное число команд в одном пакетном запросе callBatch() (не более 50).
         *
         * @type {number}
         */
        this.batchSize = 50;

        /**
         * Функция для контроля прогресса выполнения запросов.
         *
         * @type {function}
         */
        this.progress = percent => {};

        /**
         * Максимальное число запросов к API в секунду (не более 2-х).
         *
         * @type {number}
         *
         * @see https://dev.1c-bitrix.ru/rest_help/rest_sum/index.php Использование методов REST
         */
        this.throttle = 2;

        /**
         * Последний объект ajaxResult, полученный от библиотеки Битрикс24.
         *
         * @type {object}
         *
         * @see https://dev.1c-bitrix.ru/rest_help/js_library/rest/callMethod.php BX24.callMethod
         */
        this.lastResult = {};

        /**
         * Время отправки последнего запроса к API, миллисекунды.
         *
         * @type {number}
         */
        this.lastRequestTime = 0;
    }

    /**
     * Возвращает последний объект ajaxResult, полученный от библиотеки Битрикс24.
     *
     * @type {object}
     */
    getLastResult() {
        return this.lastResult;
    }

    /**
     * Создает пакет однотипных запросов в виде массива.
     *
     * @param  {string} method Метод запроса
     * @param  {array} items Массив параметров запросов
     *
     * @return {array} Пакет запросов
     */
    static createCalls(method, items) {
        let calls = [];

        for (let item of items) {
            calls.push([ method, item ]);
        }

        return calls;
    }    

    /**
     * Вызывает BX24.callMethod() c заданным методом и параметрами и возвращает объект промис.
     *
     * @param  {string} method Метод запроса
     * @param  {object} params Параметры запроса
     * @param  {function} dataExtractor Функция для извлечения данных из результатов запроса
     *
     * @return {object} Promise
     *
     * @see https://dev.1c-bitrix.ru/rest_help/js_library/rest/callMethod.php BX24.callMethod
     */
    async callMethod(method, params = {}, dataExtractor = null) {
        await this.throttleCall();

        return new Promise((resolve, reject) => {
            let callback = result => {
                this.lastResult = result;
                if (result.status != 200 || result.error()) {
                    return reject(`${result.error()} (callMethod ${method}: ${JSON.stringify(params)})`);
                }

                return resolve(dataExtractor ? dataExtractor(result.data()) : result.data());
            };

            BX24.callMethod(method, params, callback);
        });
    }

    /**
     * Вызывает BX24.callMethod() с заданным списочным методом и параметрами и возвращает объект промис.
     *
     * @param  {string} method Списочный метод запроса
     * @param  {object} params Параметры запроса
     * @param  {function} dataExtractor Функция для извлечения данных из результатов запроса
     *
     * @return {object} Promise
     *
     * @see https://dev.1c-bitrix.ru/rest_help/js_library/rest/callMethod.php BX24.callMethod
     */
    async callListMethod(method, params = {}, dataExtractor = null) {
        await this.throttleCall();

        return new Promise((resolve, reject) => {
            let data = [];
            this.progress(0);

            let callback = async (result) => {
                this.lastResult = result;

                if (result.status != 200 || result.error()) {
                    return reject(`${result.error()} (callListMethod ${method}: ${JSON.stringify(params)})`);
                }

                data = data.concat(dataExtractor ? dataExtractor(result.data()) : result.data());

                let total = result.total();
                this.progress(total > 0 ? Math.round(100 * data.length / total) : 100);

                if (! result.more()) {
                    return resolve(data);
                }

                await this.throttleCall();

                result.next();
            };

            BX24.callMethod(method, params, callback);
        });
    }

    /**
     * Вызывает BX24.callMethod() с заданным списочным методом и параметрами и возвращает объект генератор.
     * Реализует быстрый алгоритм, описанный в {@see https://dev.1c-bitrix.ru/rest_help/rest_sum/start.php}
     *
     * @param  {string} method Списочный метод запроса
     * @param  {object} params Параметры запроса
     * @param  {function} dataExtractor Функция для извлечения данных из результатов запроса
     * @param  {string} idKey Имя поля ID сущности ('ID' или 'id')
     *
     * @return {object} Generator
     *
     * @see https://dev.1c-bitrix.ru/rest_help/js_library/rest/callMethod.php BX24.callMethod
     */
    async *fetchList(method, params = {}, dataExtractor = null, idKey = 'ID') {
        params.order = params.order || {};
        params.filter = params.filter || {};
        params.start = -1;

        let moreIdKey = '>' + idKey,
            counter = 0,
            total = 0;

        params.order[ idKey ] = 'ASC';
        params.filter[ moreIdKey ] = 0;

        this.progress(0);

        do {
            let data = await this.callMethod(method, params, dataExtractor),
                result = this.lastResult;

            if (params.filter[ moreIdKey ] === 0) {
                total = result.total();
            }

            counter += data.length;
            this.progress(total > 0 ? Math.round(100 * counter / total) : 100);

            if (data.length === 0) {
                break;
            }
 
            yield data;

            if (! result.more()) {
                break;
            }
 
            params.filter[ moreIdKey ] = data[ data.length - 1 ][ idKey ];

        } while (true);
    }

    /**
     * Вызывает BX24.callBatch() с максимальным числом команд не более 50 и возвращает объект промис.
     *
     * @param  {array|object} calls Пакет запросов
     * @param  {boolean} haltOnError Прерывать исполнение пакета при возникновении ошибки
     * @param  {function} dataExtractor Функция для извлечения данных из результатов запроса
     *
     * @return {object} Promise
     *
     * @see https://dev.1c-bitrix.ru/rest_help/js_library/rest/callBatch.php BX24.callBatch
     */
    async callBatch(calls, haltOnError = true, dataExtractor = null) {
        await this.throttleCall();

        return new Promise((resolve, reject) => {
            let callback = results => {
                this.lastResult = results;
                let data;

                if (Array.isArray(results)) {
                    data = [];

                    for (let result of results) {
                        if (result.status != 200 || result.error()) {
                            if (!haltOnError && result.error()) {
                                continue;
                            }

                            return reject(`${result.error()} (callBatch ${result.query.method}: ${result.query.data})`);
                        }

                        data.push(dataExtractor ? dataExtractor(result.data()) : result.data());
                    }
                } else {
                    data = {};

                    for (let key of Object.keys(results)) {
                        let result = results[ key ];

                        if (result.status != 200 || result.error()) {
                            if (!haltOnError && result.error()) {
                                continue;
                            }

                            return reject(`${result.error()} (callBatch ${result.query.method}: ${result.query.data})`);
                        }

                        data[ key ] = dataExtractor ? dataExtractor(result.data()) : result.data();
                    }                    
                }

                return resolve(data);
            };

            BX24.callBatch(calls, callback, haltOnError);
        });
    }

    /**
     * Вызывает BX24.callBatch() с произвольным числом запросов и возвращает объект промис.
     *
     * @param  {array} calls Пакет запросов
     * @param  {boolean} haltOnError Прерывать исполнение пакета при возникновении ошибки
     * @param  {function} dataExtractor Функция для извлечения данных из результатов запроса
     *
     * @return {object} Promise
     *
     * @see https://dev.1c-bitrix.ru/rest_help/js_library/rest/callBatch.php BX24.callBatch
     */
    async callLongBatch(calls, haltOnError = true, dataExtractor = null) {
        if (! Array.isArray(calls)) {
            throw "Parameter 'calls' must be an array.";
        }

        let data = [],
            total = calls.length,
            start = 0;

        this.progress(0);

        do {
            let end = start + this.batchSize,
                chunk = calls.slice(start, end);

            let response = await this.callBatch(chunk, haltOnError, dataExtractor);
            data = data.concat(response);

            this.progress(total > 0 ? Math.round(100 * data.length / total) : 100);

            start = end;
            if (start >= total) {
                break;
            }

        } while(true);

        return data;
    }

    /**
     * Вызывает BX24.callBatch() с произвольным числом команд в запросе и возвращает объект генератор.
     *
     * @param  {array} calls Пакет запросов
     * @param  {boolean} haltOnError Прерывать исполнение пакета при возникновении ошибки
     * @param  {function} dataExtractor Функция для извлечения данных из результатов запроса
     *
     * @return {object} Generator
     *
     * @see https://dev.1c-bitrix.ru/rest_help/js_library/rest/callBatch.php BX24.callBatch
     */
    async *callLargeBatch(calls, haltOnError = true, dataExtractor = null) {
        if (! Array.isArray(calls)) {
            throw "Parameter 'calls' must be an array.";
        }

        let total = calls.length,
            counter = 0,
            start = 0;

        this.progress(0);

        do {
            let end = start + this.batchSize,
                chunk = calls.slice(start, end);

            let data = await this.callBatch(chunk, haltOnError, dataExtractor = null);
            
            counter += data.length;
            this.progress(total > 0 ? Math.round(100 * counter / total) : 100);

            yield data;

            start = end;
            if (start >= total) {
                break;
            }

        } while(true);
    }

    /**
     * Обеспечивает троттлинг запросов к API Битрикс24 на заданном уровне.
     *
     * @return {object} Promise
     */
    throttleCall() {
        return new Promise(resolve => {
            let timeout = Math.round(this.lastRequestTime + 1e3 * (1 / this.throttle) - Date.now());

            if (timeout <= 0) {
                this.lastRequestTime = Date.now();
                return resolve();
            }

            setTimeout(() => {
                this.lastRequestTime = Date.now();
                return resolve();
            }, timeout);
        });
    }
}
