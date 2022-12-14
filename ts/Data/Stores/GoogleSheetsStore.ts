/* *
 *
 *  (c) 2012-2021 Highsoft AS
 *
 *  License: www.highcharts.com/license
 *
 *  !!!!!!! SOURCE GETS TRANSPILED BY TYPESCRIPT. EDIT TS FILE ONLY. !!!!!!!
 *
 *  Authors:
 *  - Torstein Hønsi
 *  - Gøran Slettemark
 *  - Wojciech Chmiel
 *  - Sophie Bremer
 *
 * */

'use strict';

/* *
 *
 *  Imports
 *
 * */

import type DataEvent from '../DataEvent';
import type JSON from '../../Core/JSON';

import DataPromise from '../DataPromise.js';
import DataStore from './DataStore.js';
import DataTable from '../DataTable.js';
import GoogleSheetsConverter from '../Converters/GoogleSheetsConverter.js';
import HU from '../../Core/HttpUtilities.js';
const { ajax } = HU;
import U from '../../Core/Utilities.js';
const {
    merge,
    pick
} = U;

/* *
 *
 *  Class
 *
 * */

/**
 * @private
 * @todo implement save, requires oauth2
 */
class GoogleSheetsStore extends DataStore {

    /* *
     *
     *  Static Properties
     *
     * */

    protected static readonly defaultOptions: GoogleSheetsStore.Options = {
        googleAPIKey: '',
        googleSpreadsheetKey: '',
        worksheet: 1,
        enablePolling: false,
        dataRefreshRate: 2,
        firstRowAsNames: true
    };

    /* *
     *
     *  Constructor
     *
     * */

    /**
     * Constructs an instance of GoogleSheetsStore
     *
     * @param {DataTable} table
     * Optional table to create the store from.
     *
     * @param {CSVStore.OptionsType} options
     * Options for the store and converter.
     *
     * @param {DataConverter} converter
     * Optional converter to replace the default converter.
     */
    public constructor(
        table: DataTable,
        options: (
            Partial<GoogleSheetsStore.Options>&
            {
                googleAPIKey: string;
                googleSpreadsheetKey: string;
            }
        ),
        converter?: GoogleSheetsConverter
    ) {
        super(table);
        this.options = merge(GoogleSheetsStore.defaultOptions, options);
        this.converter = converter || new GoogleSheetsConverter({
            firstRowAsNames: this.options.firstRowAsNames
        });
    }

    /* *
     *
     *  Properties
     *
     * */

    public readonly options: GoogleSheetsStore.Options;

    /**
     * The attached converter, which can be replaced in the constructor
     */
    public readonly converter: GoogleSheetsConverter;

    /* *
     *
     *  Functions
     *
     * */

    /**
     * Loads data from a Google Spreadsheet.
     *
     * @param {DataEvent.Detail} [eventDetail]
     * Custom information for pending events.
     */
    public load(eventDetail?: DataEvent.Detail): DataPromise<this> {
        const store = this,
            {
                dataRefreshRate,
                enablePolling,
                firstRowAsNames,
                googleAPIKey,
                googleSpreadsheetKey
            } = store.options,
            url = GoogleSheetsStore.buildFetchURL(
                googleAPIKey,
                googleSpreadsheetKey,
                store.options
            );

        // If already loaded, clear the current table
        store.table.deleteColumns();

        store.emit<GoogleSheetsStore.Event>({
            type: 'load',
            detail: eventDetail,
            table: store.table,
            url
        });

        ajax({
            url,
            dataType: 'json',
            success: (json): void => {
                store.converter.parse({
                    firstRowAsNames,
                    json: json as GoogleSheetsConverter.GoogleSpreadsheetJSON
                });
                store.table.setColumns(store.converter.getTable().getColumns());

                store.emit<GoogleSheetsStore.Event>({
                    type: 'afterLoad',
                    detail: eventDetail,
                    table: store.table,
                    url
                });

                // Polling
                if (enablePolling) {
                    setTimeout(
                        (): DataPromise<this> => store.load(),
                        dataRefreshRate * 1000
                    );
                }
            },
            error: (
                xhr: XMLHttpRequest,
                error: (string|Error)
            ): void => {
                store.emit<GoogleSheetsStore.Event>({
                    type: 'loadError',
                    detail: eventDetail,
                    error,
                    table: store.table,
                    xhr
                });
            }
        });

        return DataPromise.resolve(this);
    }

}

/* *
 *
 *  Class Namespace
 *
 * */

namespace GoogleSheetsStore {

    /* *
     *
     *  Declarations
     *
     * */

    export type Event = (ErrorEvent|LoadEvent);

    export interface ErrorEvent extends DataStore.Event {
        readonly type: 'loadError';
        readonly error: (string|Error);
        readonly xhr: XMLHttpRequest;
    }

    export interface FetchURLOptions {
        onlyColumnNames?: boolean;
    }

    export interface LoadEvent extends DataStore.Event {
        readonly type: ('load'|'afterLoad');
        readonly url: string;
    }

    export interface Options extends JSON.Object {
        dataRefreshRate: number;
        enablePolling: boolean;
        endColumn?: number;
        endRow?: number;
        firstRowAsNames: boolean;
        googleAPIKey: string;
        googleSpreadsheetKey: string;
        googleSpreadsheetRange?: string;
        startColumn?: number;
        startRow?: number;
        worksheet?: number;
    }

    /* *
     *
     *  Constants
     *
     * */

    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    /* *
     *
     *  Functions
     *
     * */

    /**
     * @private
     */
    export function buildFetchURL(
        apiKey: string,
        sheetKey: string,
        options: Partial<(FetchURLOptions|Options)> = {}
    ): string {
        return (
            `https://sheets.googleapis.com/v4/spreadsheets/${sheetKey}/values/` +
            (
                options.onlyColumnNames ?
                    'A1:Z1' :
                    buildQueryRange(options)
            ) +
            '?alt=json' +
            (
                options.onlyColumnNames ?
                    '' :
                    '&dateTimeRenderOption=FORMATTED_STRING' +
                    '&majorDimension=COLUMNS' +
                    '&valueRenderOption=UNFORMATTED_VALUE'
            ) +
            '&prettyPrint=false' +
            `&key=${apiKey}`
        );
    }

    /**
     * @private
     */
    export function buildQueryRange(
        options: Partial<Options> = {}
    ): string {
        const {
            endColumn,
            endRow,
            googleSpreadsheetRange,
            startColumn,
            startRow
        } = options;

        return googleSpreadsheetRange || (
            (alphabet[startColumn || 0] || 'A') +
            (Math.max((startRow || 0), 0) + 1) +
            ':' +
            (alphabet[pick(endColumn, 25)] || 'Z') +
            (
                endRow ?
                    Math.max(endRow, 0) :
                    'Z'
            )
        );
    }

}

/* *
 *
 *  Registry
 *
 * */

DataStore.addStore(GoogleSheetsStore);

declare module './StoreType' {
    interface StoreTypeRegistry {
        Google: typeof GoogleSheetsStore;
    }
}

/* *
 *
 *  Default Export
 *
 * */

export default GoogleSheetsStore;
