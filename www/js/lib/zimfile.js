/**
 * zimfile.js: Low-level ZIM file reader.
 *
 * Copyright 2015 Mossroy and contributors
 * License GPL v3:
 *
 * This file is part of Evopedia.
 *
 * Evopedia is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Evopedia is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Evopedia (file LICENSE-GPLv3.txt).  If not, see <http://www.gnu.org/licenses/>
 */
'use strict';
define(['xzdec_wrapper', 'util', 'utf8'], function(xz, util, utf8) {

    var readInt = function(data, offset, size)
    {
        var r = 0;
        for (var i = 0; i < size; i++)
        {
            var c = (data[offset + i] + 256) & 0xff;
            r += c << (8 * i);
        }
        return r;
    };
                
    /**
     * A ZIM File
     * 
     * See http://www.openzim.org/wiki/ZIM_file_format#Header
     * 
     * @typedef ZIMFile
     * @property {File} _file The ZIM file
     * @property {Integer} articleCount total number of articles
     * @property {Integer} clusterCount total number of clusters
     * @property {Integer} urlPtrPos position of the directory pointerlist ordered by URL
     * @property {Integer} titlePtrPos position of the directory pointerlist ordered by title
     * @property {Integer} clusterPtrPos position of the cluster pointer list
     * @property {Integer} mimeListPos position of the MIME type list (also header size)
     * @property {Integer} mainPage main page or 0xffffffff if no main page
     * @property {Integer} layoutPage layout page or 0xffffffffff if no layout page
     * 
     */
    
    /**
     * @param {File} abstractFile
     */
    function ZIMFile(abstractFile)
    {
        this._file = abstractFile;
    }

    /**
     * 
     * @param {Integer} offset
     * @param {Integer} size
     * @returns {Integer}
     */
    ZIMFile.prototype._readInteger = function(offset, size)
    {
        return util.readFileSlice(this._file, offset, size).then(function(data)
        {
            return readInt(data, 0, size);
        });
    };

    /**
     * 
     * @param {Integer} offset
     * @param {Integer} size
     * @returns {Promise}
     */
    ZIMFile.prototype._readSlice = function(offset, size)
    {
        return util.readFileSlice(this._file, offset, size);
    };

    /**
     * 
     * @param {Integer} offset
     * @returns {unresolved} DirEntry data (without the file)
     */
    ZIMFile.prototype.dirEntry = function(offset)
    {
        var that = this;
        return this._readSlice(offset, 2048).then(function(data)
        {
            var dirEntry =
            {
                offset: offset,
                mimetype: readInt(data, 0, 2),
                namespace: String.fromCharCode(data[3])
            };
            dirEntry.isRedirect = (dirEntry.mimetype === 0xffff);
            if (dirEntry.isRedirect)
                dirEntry.redirectTarget = readInt(data, 8, 4);
            else
            {
                dirEntry.cluster = readInt(data, 8, 4);
                dirEntry.blob = readInt(data, 12, 4);
            }
            var pos = dirEntry.isRedirect ? 12 : 16;
            dirEntry.url = utf8.parse(data.subarray(pos), true);
            while (data[pos] !== 0)
                pos++;
            dirEntry.title = utf8.parse(data.subarray(pos + 1), true);
            return dirEntry;
        });
    };

    /**
     * 
     * @param {Integer} index
     * @returns {unresolved} DirEntry data (without the file)
     */
    ZIMFile.prototype.dirEntryByUrlIndex = function(index)
    {
        var that = this;
        return this._readInteger(this.urlPtrPos + index * 8, 8).then(function(dirEntryPos)
        {
            return that.dirEntry(dirEntryPos);
        });
    };

    /**
     * 
     * @param {Integer} index
     * @returns {unresolved} DirEntry data (without the file)
     */
    ZIMFile.prototype.dirEntryByTitleIndex = function(index)
    {
        var that = this;
        return this._readInteger(this.titlePtrPos + index * 4, 4).then(function(urlIndex)
        {
            return that.dirEntryByUrlIndex(urlIndex);
        });
    };

    /**
     * 
     * @param {Integer} cluster
     * @param {Integer} blob
     * @returns {String}
     */
    ZIMFile.prototype.blob = function(cluster, blob)
    {
        var that = this;
        //@todo decompress in a streaming way, otherwise we have to "guess" the sizes
        return this._readSlice(this.clusterPtrPos + cluster * 8, 16).then(function(clusterOffsets)
        {
            var clusterOffset = readInt(clusterOffsets, 0, 8);
            var nextCluster = readInt(clusterOffsets, 8, 8);
            //@todo we assume it is compressed - handle uncompressed (first byte at clusterOffset)
            var reader = function(offset, size) {
                return that._readSlice(clusterOffset + 1 + offset, size);
            };
            var dec = new xz.Decompressor(reader);
            return dec.readSlice(blob * 4, 8).then(function(data) {
                var blobOffset = readInt(data, 0, 4);
                var nextBlobOffset = readInt(data, 4, 4);
                return dec.readSlice(blobOffset, nextBlobOffset - blobOffset).then(function(data) {
                    dec.end();
                    return utf8.parse(data);
                });
            });
        });
    };

    return {
        /**
         * 
         * @param {File} file
         * @returns {Promise}
         */
        fromFile: function(file) {
            return util.readFileSlice(file, 0, 80).then(function(header)
            {
                var zf = new ZIMFile(file);
                zf.articleCount = readInt(header, 24, 4);
                zf.clusterCount = readInt(header, 28, 4);
                zf.urlPtrPos = readInt(header, 32, 8);
                zf.titlePtrPos = readInt(header, 40, 8);
                zf.clusterPtrPos = readInt(header, 48, 8);
                zf.mimeListPos = readInt(header, 56, 8);
                zf.mainPage = readInt(header, 64, 4);
                zf.layoutPage = readInt(header, 68, 4);
                return zf;
            });
        }
    };
});
