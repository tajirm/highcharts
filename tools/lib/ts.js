/* *
 *
 *  Handles TypeScript API and provides a simplified AST for doclet-relevant
 *  source nodes.
 *
 *  (c) Highsoft AS
 *
 *  Authors:
 *  - Sophie Bremer
 *
 * */


/* eslint-disable no-console, no-underscore-dangle, no-unused-expressions, no-use-before-define */


/* *
 *
 *  Imports
 *
 * */


const FS = require('node:fs');


const TS = require('typescript');


/* *
 *
 *  Constants
 *
 * */


const DOCLET = /\/\*\*.*?\*\//gsu;


const NATIVE_TYPES = [
    'Array',
    'Function',
    'NaN',
    'Number',
    'Object',
    'String',
    'Symbol'
];


const TYPE_SPLIT = /\W+/gsu;


/* *
 *
 *  Functions
 *
 * */

/**
 * Adds a tag to a DocletInfo object.
 *
 * @param {DocletInfo} doclet
 * Doclet information to modify.
 *
 * @param {string} tag
 * Tag to add to.
 *
 * @param {string|undefined} [text]
 * Text to add.
 *
 * @return {DocletInfo}
 * DocletInfo object as reference.
 */
function addTag(
    doclet,
    tag,
    text
) {
    const tags = doclet.tags;

    tags[tag] = tags[tag] || [];

    if (text) {
        tags[tag].push(text);
    }

}


/**
 * Shifts ranges in the source code with replacements.
 *
 * @param {string} sourceCode
 * Source code to change.
 *
 * @param {Array<[number,number,string]} replacements
 * Replacements to apply.
 *
 * @return {string}
 * Changed source code.
 */
function changeSourceCode(
    sourceCode,
    replacements
) {

    if (
        !replacements ||
        !replacements.length
    ) {
        return sourceCode;
    }

    for (const replacement of replacements.sort((a, b) => b[0] - a[0])) {
        sourceCode = (
            sourceCode.substring(0, replacement[0]) +
            replacement[2] +
            sourceCode.substring(replacement[1])
        );
    }

    return sourceCode;
}


/**
 * Shifts ranges in the source file with replacements.
 *
 * @param {TS.SourceFile} sourceFile
 * Source file to change.
 *
 * @param {Array<[number,number,string]} replacements
 * Replacements to apply.
 *
 * @return {TS.SourceFile}
 * New source file with changes.
 */
function changeSourceFile(
    sourceFile,
    replacements
) {

    if (
        !replacements ||
        !replacements.length
    ) {
        return sourceFile;
    }

    return TS.createSourceFile(
        sourceFile.fileName,
        changeSourceCode(sourceFile.getFullText(), replacements),
        TS.ScriptTarget.ESNext,
        true
    );
}


/**
 * Logs debug information for a node and its children into the console.
 *
 * @param {TS.Node} node
 * Node to debug.
 *
 * @param {number} [depth=0]
 * Level of debug depth regarding children.
 *
 * @param {string} [indent=""]
 * Internal parameter.
 */
function debug(
    node,
    depth = 0,
    indent = ''
) {

    if (!node) {
        console.info(indent + 0, 'undefined', '[-:-]');
        return;
    }

    console.info(
        indent + node.kind,
        TS.SyntaxKind[node.kind],
        `[${node.getFullStart()}:${node.getEnd()}]`
    );

    if (depth-- > 0) {
        indent += '  ';
        for (const child of getNodesChildren(node)) {
            debug(child, depth, indent);
        }
    }

}


/**
 * Extracts all types of a type statement, including intersects and unions.
 *
 * @param {string} typeString
 * Type statement as string to extract from.
 *
 * @param {boolean} [includeNativeTypes]
 * Set `true` to include TypeScript's native types.
 *
 * @return {Array<string>}
 * Array of extracted types.
 */
function extractTypes(
    typeString,
    includeNativeTypes
) {
    /** @type {Array<string>} */
    const types = [];

    for (const part of typeString.split(TYPE_SPLIT)) {

        if (
            !includeNativeTypes &&
            isNativeType(part)
        ) {
            continue;
        }

        if (!types.includes(part)) {
            types.push(part);
        }

    }

    return types;
}


/**
 * Retrieve child informations.
 *
 * @param {Array<TS.Node>} nodes
 * Child nodes to extract from.
 *
 * @param {boolean} includeNodes
 * Whether to include the TypeScript nodes in the information.
 *
 * @return {Array<NodeInfo>}
 * Retrieved child informations.
 */
function getChildInfos(
    nodes,
    includeNodes
) {
    /** @type {Array<NodeInfo>} */
    const _infos = [];

    /** @type {DocletInfo} */
    let _doclet;
    /** @type {Array<DocletInfo>} */
    let _doclets;
    /** @type {NodeInfo} */
    let _child;
    /** @type {TS.Node} */
    let previousNode = nodes[0];

    for (const node of nodes) {

        if (node.kind === TS.SyntaxKind.EndOfFileToken) {
            break;
        }

        if (
            TS.isVariableDeclarationList(node) ||
            TS.isVariableStatement(node)
        ) {
            _infos.push(...getChildInfos(getNodesChildren(node), includeNodes));
            continue;
        }

        _child = (
            getVariableInfo(node, includeNodes) ||
            getPropertyInfo(node, includeNodes) ||
            getObjectInfo(node, includeNodes) ||
            getInterfaceInfo(node, includeNodes) ||
            getImportInfo(node, includeNodes) ||
            getFunctionInfo(node, includeNodes) ||
            getDeconstructInfos(node, includeNodes) ||
            getExportInfo(node, includeNodes) ||
            getClassInfo(node, includeNodes)
        );

        // Retrieve leading doclets

        _doclets = getDocletInfosBetween(previousNode, node, includeNodes);

        if (!_child) {
            _infos.push(..._doclets);
            continue;
        }

        // Deal with floating doclets before child doclet

        if (_doclets.length) {
            _doclet = _doclets[_doclets.length - 1];
            if (
                _child.kind !== 'Export' &&
                _child.kind !== 'Import' &&
                !_doclet.tags.apioption
            ) {
                _child.doclet = _doclets.pop();
            }
            _infos.push(..._doclets);
        }

        // Finally add child

        _infos.push(_child);

        previousNode = node;

    }

    return _infos;
}


/**
 * Retrieves class info from the given node.
 *
 * @param {TS.Node} node
 * Node that might be a class.
 *
 * @param {boolean} includeNodes
 * Whether to include the TypeScript nodes in the information.
 *
 * @return {ClassInfo|undefined}
 * Class information or `undefined`.
 */
function getClassInfo(
    node,
    includeNodes
) {

    if (!TS.isClassDeclaration(node)) {
        return void 0;
    }

    /** @type {ClassInfo} */
    const _info = {
        kind: 'Class'
    };

    _info.name = ((node.name && node.name.getText()) || 'default');

    if (node.typeParameters) {
        const _generics = _info.generics = [];
        for (const parameter of getChildInfos(node.typeParameters)) {
            if (parameter.kind === 'Variable') {
                _generics.push(parameter);
            }
        }
    }

    if (node.heritageClauses) {
        for (const clause of node.heritageClauses) {
            if (clause.token === TS.SyntaxKind.ExtendsKeyword) {
                _info.extends = clause.types.map(t => t.getText());
            } else {
                _info.implements = clause.types.map(t => t.getText());
            }
        }
    }

    if (node.members) {
        const _properties = _info.properties = [];
        for (const member of getChildInfos(node.members, includeNodes)) {
            if (
                member.kind === 'Doclet' ||
                member.kind === 'Function' ||
                member.kind === 'Property'
            ) {
                _properties.push(member);
            }
        }
    }

    if (includeNodes) {
        _info.node = node;
    }

    return _info;
}


/**
 * Retrieves deconstruct information from the given node.
 *
 * @param {TS.Node} node
 * Node that might be a deconstruct.
 *
 * @param {boolean} includeNodes
 * Whether to include the TypeScript node in the information.
 *
 * @return {DeconstructInfo|undefined}
 * Deconstruct information or `undefined`.
 */
function getDeconstructInfos(
    node,
    includeNodes
) {

    if (
        !TS.isParameter(node) &&
        !TS.isVariableDeclaration(node)
    ) {
        return void 0;
    }

    if (
        !TS.isArrayBindingPattern(node.name) &&
        !TS.isObjectBindingPattern(node.name)
    ) {
        return void 0;
    }

    /** @type {DeconstructInfo} */
    const _info = {
        kind: 'Deconstruct',
        deconstructs: {}
    };

    if (node.initializer) {
        _info.from = node.initializer.getText();
    }

    for (const element of node.name.elements) {
        _info.deconstructs[(element.propertyName || element.name).text] =
            element.name.text;
    }

    if (includeNodes) {
        _info.node = node;
    }

    return _info;
}


/**
 * Retrieve doclet informations between two nodes.
 *
 * @param {TS.Node} startNode
 * Node that comes before doclets.
 *
 * @param {TS.Node} endNode
 * Node that comes after doclets.
 *
 * @param {boolean} includeNodes
 * Whether to include the TypeScript nodes in the information.
 *
 * @return {Array<DocletInfo>}
 * Retrieved doclet informations.
 */
function getDocletInfosBetween(
    startNode,
    endNode,
    includeNodes
) {
    /** @type {Array<DocletInfo>} */
    const _doclets = [];

    /** @type {DocletInfo} */
    let _doclet;
    /** @type {string} */
    let _tagName;

    for (const doclet of getDocletsBetween(startNode, endNode)) {

        _doclet = newDocletInfo();

        for (const node of doclet) {
            if (TS.isJSDoc(node)) {
                if (node.comment) {
                    addTag(
                        _doclet,
                        'description',
                        node.comment instanceof Array ?
                            node.comment
                                .map(c => c.text)
                                .join('\n')
                                .trim() :
                            node.comment
                                .trim()
                    );
                }
                if (node.tags) {
                    for (const tag of node.tags) {
                        _tagName = tag.tagName.getText();
                        addTag(
                            _doclet,
                            _tagName,
                            tag.getText()
                                .substring(_tagName.length + 1)
                                .split(/\n *\*?/gu)
                                .join('\n')
                                .trim()
                        );
                    }
                    if (includeNodes) {
                        _doclet.node = node;
                    }
                }
            }
        }

        _doclets.push(_doclet);

    }

    return _doclets;
}


/**
 * Retrieves all doclet nodes between two nodes.
 *
 * @param {TS.Node} startNode
 * Start node that comes before doclets.
 *
 * @param {TS.Node} endNode
 * End node that comes after doclets.
 *
 * @return {Array<ReturnType<TS.getJSDocCommentsAndTags>>}
 * Array of doclet nodes.
 *
 * @todo add function for simple array<doclet<tags>>
 */
function getDocletsBetween(
    startNode,
    endNode
) {
    /** @type {Array<ReturnType<TS.getJSDocCommentsAndTags>>} */
    const doclets = [];
    const end = endNode.getStart();
    const start = (
        startNode === endNode ?
            startNode.getFullStart() :
            startNode.getEnd()
    );

    /** @type {ReturnType<TS.getJSDocCommentsAndTags>} */
    let parts;

    TS.forEachChild(
        TS.createSourceFile(
            'doclets.ts',
            Array
                .from(
                    startNode
                        .getSourceFile()
                        .getFullText()
                        .substring(start, end)
                        .matchAll(DOCLET)
                )
                .map(match => match[0] + '\n\'\';\n')
                .join(''),
            TS.ScriptTarget.Latest,
            true
        ),
        node => {
            parts = TS.getJSDocCommentsAndTags(node);
            if (parts.length) {
                doclets.push(parts);
            }
        }
    );

    return doclets;
}


/**
 * Retrieves export information from the given node.
 *
 * @param {TS.Node} node
 * Node that might be an export.
 *
 * @param {boolean} includeNodes
 * Whether to include the TypeScript nodes in the information.
 *
 * @return {NodeInfo|undefined}
 * Export information or `undefined`.
 */
function getExportInfo(
    node,
    includeNodes
) {

    if (
        !TS.isExportAssignment(node) &&
        !TS.isExportDeclaration(node) &&
        !TS.isExportSpecifier(node)
    ) {
        return void 0;
    }

    // debug(node, 4);

    return void 0;
}


/**
 * Retrieves import information from the given node.
 *
 * @param {TS.Node} node
 * Node that might be an import.
 *
 * @param {boolean} includeNodes
 * Whether to include the TypeScript nodes in the information.
 *
 * @return {ImportInfo|undefined}
 * Import information or `undefined`.
 */
function getFunctionInfo(
    node,
    includeNodes
) {

    if (
        !TS.isConstructorDeclaration(node) &&
        !TS.isFunctionDeclaration(node) &&
        !TS.isMethodDeclaration(node)
    ) {
        return void 0;
    }

    /** @type {FunctionInfo} */
    const _info = {
        kind: 'Function'
    };

    _info.name = (
        TS.isConstructorDeclaration(node) ?
            'constructor' :
            ((node.name && node.name.getText()) || '')
    );

    if (node.typeParameters) {
        const _generics = _info.generics = [];
        for (const parameter of getChildInfos(node.typeParameters)) {
            if (parameter.kind === 'Variable') {
                _generics.push(parameter);
            }
        }
    }

    if (node.parameters) {
        const _parameters = _info.parameters = [];
        for (const parameter of getChildInfos(node.parameters, includeNodes)) {
            if (parameter.kind === 'Variable') {
                _parameters.push(parameter);
            }
        }
    }

    if (node.type) {
        _info.return = node.type.getText();
    }

    if (includeNodes) {
        _info.node = node;
    }

    return _info;
}


/**
 * Retrieves import information from the given node.
 *
 * @param {TS.Node} node
 * Node that might be an import.
 *
 * @param {boolean} includeNode
 * Whether to include the TypeScript node in the information.
 *
 * @return {ImportInfo|undefined}
 * Import information or `undefined`.
 */
function getImportInfo(
    node,
    includeNode
) {

    if (!TS.isImportDeclaration(node)) {
        return void 0;
    }

    /** @type {ImportInfo} */
    const _info = {
        kind: 'Import'
    };

    _info.from = node.moduleSpecifier
        .getText()
        .replace(/^(['"])(.*)\1$/u, '$2');

    if (node.importClause) {
        const _imports = _info.imports = {};

        /** @type {string} */
        let propertyName;

        for (const clause of getNodesChildren(node.importClause)) {
            if (TS.isIdentifier(clause)) {
                _imports.default = clause.getText();
            }
            if (TS.isNamedImports(clause)) {
                for (const child of getNodesChildren(clause)) {
                    if (TS.isImportSpecifier(child)) {
                        propertyName = (
                            child.propertyName &&
                            child.propertyName.getText() ||
                            child.name.getText()
                        );
                        _imports[propertyName] = child.name.getText();
                    }
                }
            }
        }

    }

    if (includeNode) {
        _info.node = node;
    }

    return _info;
}


/**
 * Retrieves interface information from the given node.
 *
 * @param {TS.Node} node
 * Node that might be an interface.
 *
 * @param {boolean} includeNodes
 * Whether to include the TypeScript nodes in the information.
 *
 * @return {InterfaceInfo|undefined}
 * Interface or `undefined`.
 */
function getInterfaceInfo(
    node,
    includeNodes
) {

    if (!TS.isInterfaceDeclaration(node)) {
        return void 0;
    }

    /** @type {InterfaceInfo} */
    const _info = {
        kind: 'Interface'
    };

    _info.name = node.name.getText();

    if (node.typeParameters) {
        const _generics = _info.generics = [];
        for (const parameter of getChildInfos(node.typeParameters)) {
            if (parameter.kind === 'Variable') {
                _generics.push(parameter);
            }
        }
    }

    if (node.heritageClauses) {
        for (const clause of node.heritageClauses) {
            if (clause.token === TS.SyntaxKind.ExtendsKeyword) {
                _info.extends = clause.types.map(t => t.getText());
            } else {
                _info.implements = clause.types.map(t => t.getText());
            }
        }
    }

    if (node.members) {
        const _properties = _info.properties = [];
        for (const member of getChildInfos(node.members, includeNodes)) {
            if (
                member.kind === 'Doclet' ||
                member.kind === 'Interface' ||
                member.kind === 'Property'
            ) {
                _properties.push(member);
            }
        }
    }

    if (includeNodes) {
        _info.node = node;
    }

    return _info;
}


/**
 * Retrieves all logical children and skips statement tokens.
 *
 * @param {TS.Node} node
 * Node to retrieve logical children from.
 *
 * @return {Array<TS.Node>}
 * Array of logical children.
 */
function getNodesChildren(
    node
) {
    /** @type {Array<TS.Node>} */
    const children = [];

    TS.forEachChild(node, child => {
        children.push(child);
    });

    return children;
}


/**
 * Retrieve the first logical child of a node.
 *
 * @param {TS.Node} node
 * Node to retrieve the first logical child from.
 *
 * @return {TS.Node|undefined}
 * First logical child, if found.
 */
function getNodesFirstChild(
    node
) {
    return getNodesChildren(node).shift();
}


/**
 * Retrieve the last logical child of a node.
 *
 * @param {TS.Node} node
 * Node to retrieve the last logical child from.
 *
 * @return {TS.Node|undefined}
 * Last logical child, if found.
 */
function getNodesLastChild(
    node
) {
    return getNodesChildren(node).pop();
}


/**
 * Retrieves object information from the current node.
 *
 * @param {TS.Node} node
 * Node that might be an object literal.
 *
 * @param {boolean} includeNodes
 * Whether to include the TypeScript nodes in the information.
 *
 * @return {ObjectInfo}
 * Object information or `undefined`.
 */
function getObjectInfo(
    node,
    includeNodes
) {
    /** @type {string|undefined} */
    let _type;

    if (TS.isAsExpression(node)) {
        _type = node.type.getText();
        node = node.expression;
    }

    if (!TS.isObjectLiteralExpression(node)) {
        return void 0;
    }

    /** @type {ObjectInfo} */
    const _info = {
        kind: 'Object'
    };

    if (node.properties) {
        const _properties = _info.properties = [];
        for (const property of getChildInfos(node.properties, includeNodes)) {
            if (
                property.kind === 'Doclet' ||
                property.kind === 'Property'
            ) {
                _properties.push(property);
            }
        }
    }

    if (_type) {
        _info.type = _type;
    }

    if (includeNodes) {
        _info.node = node;
    }

    return _info;
}


/**
 * Retrieves property information from the current node.
 *
 * @param {TS.Node} node
 * Node that might be a property.
 *
 * @param {boolean} includeNode
 * Whether to include the TypeScript node in the information.
 *
 * @return {PropertyInfo|undefined}
 * Property information or `undefined`.
 */
function getPropertyInfo(
    node,
    includeNode
) {

    if (
        !TS.isPropertyAssignment(node) &&
        !TS.isPropertyDeclaration(node) &&
        !TS.isPropertySignature(node)
    ) {
        return void 0;
    }

    /** @type {PropertyInfo} */
    const _info = {
        kind: 'Property'
    };

    _info.name = node.name.getText();

    if (node.type) {
        _info.type = node.type.getText();
    }

    if (
        !TS.isPropertySignature(node) &&
        node.initializer
    ) {
        const expression = getChildInfos([node.initializer]);

        if (expression.length) {
            _info.value = expression[0];
        } else {
            _info.value = node.initializer.getText();
        }
    }

    if (includeNode) {
        _info.node = node;
    }

    return _info;
}


/**
 * Retrieves source information from the given file path.
 *
 * @param {string} filePath
 * Path to source file.
 *
 * @param {boolean} includeNodes
 * Whether to include the TypeScript nodes in the information.
 *
 * @return {SourceInfo}
 * Source information or exception.
 */
function getSourceInfo(
    filePath,
    includeNodes
) {
    const sourceFile = TS.createSourceFile(
        filePath,
        FS.readFileSync(filePath, 'utf8'),
        TS.ScriptTarget.Latest,
        true
    );

    /** @type {SourceInfo} */
    const _info = {
        kind: 'Source',
        path: filePath
    };

    _info.code = getChildInfos(getNodesChildren(sourceFile), includeNodes);

    if (includeNodes) {
        _info.node = sourceFile;
    }

    return _info;
}


/**
 * Retrieves the last text of the specified tag from a DocletInfo object.
 *
 * @param {DocletInfo} doclet
 * Doclet information to retrieve from.
 *
 * @param {string} tag
 * Tag to retrieve.
 *
 * @return {string|undefined}
 * Retrieved text or `undefined`.
 */
function getTagText(
    doclet,
    tag
) {
    const tagText = doclet.tags[tag];

    if (tagText && tagText.length) {
        return tagText[tagText.length - 1];
    }

    return void 0;
}


/**
 * Retrieves variable information from the given node.
 *
 * @param {TS.Node} node
 * Node that might be a variable or assignment.
 *
 * @param {boolean} includeNodes
 * Whether to include the TypeScript node in the information.
 *
 * @return {VariableInfo|undefined}
 * Variable information or `undefined`.
 */
function getVariableInfo(
    node,
    includeNodes
) {

    if (
        (
            !TS.isTypeParameterDeclaration(node) &&
            !TS.isParameter(node) &&
            !TS.isVariableDeclaration(node)
        ) ||
        TS.isArrayBindingPattern(node.name) ||
        TS.isObjectBindingPattern(node.name)
    ) {
        return void 0;
    }

    /** @type {VariableInfo} */
    const _info = {
        kind: 'Variable',
        name: node.name.getText()
    };

    if (TS.isTypeParameterDeclaration(node)) {
        if (node.constraint) {
            _info.type = node.constraint.getText();
        }
        if (node.default) {
            _info.value = node.default.getText();
        }
    } else {
        if (node.type) {
            _info.type = node.type.getText();
        }
        if (node.initializer) {
            const expression = getChildInfos([node.initializer]);

            if (expression.length) {
                _info.value = expression[0];
            } else {
                _info.value = node.initializer.getText();
            }
        }
    }

    if (includeNodes) {
        _info.node = node;
    }

    return _info;
}


/**
 * Tests if a text string starts with upper case.
 *
 * @param {string} text
 * Text string to test.
 *
 * @return {boolean}
 * `true`, if text string starts with upper case.
 */
function isCapitalCase(
    text
) {
    const firstChar = `${text}`.charAt(0);

    return (firstChar === firstChar.toUpperCase());
}


/**
 * Tests if a type is integrated into TypeScript.
 *
 * @param {string} type
 * Type to test.
 *
 * @return {boolean}
 * `true`, if type is integrated into TypeScript.
 */
function isNativeType(
    type
) {
    return (
        type.length < 2 ||
        !isCapitalCase(type) ||
        NATIVE_TYPES.includes(type) ||
        type.startsWith('Array') ||
        TS.SyntaxKind[type] > 0
    );
}


/**
 * Creates a new DocletInfo object.
 *
 * @param {DocletInfo} [template]
 * Doclet information to apply.
 *
 * @return {DocletInfo}
 * The new doclet information.
 */
function newDocletInfo(
    template
) {
    /** @type {DocletInfo} */
    const doclet = {
        kind: 'Doclet',
        tags: {}
    };

    if (template) {
        const newTags = doclet.tags;
        const tags = template.tags;

        for (const tag of Object.keys(tags)) {
            newTags[tag] = tags[tag].slice();
        }
    }

    return doclet;
}


/**
 * Removes a tag from a DocletInfo object.
 *
 * @param {DocletInfo} doclet
 * Doclet information to modify.
 *
 * @param {string} tag
 * Tag to remove.
 *
 * @return {Array<string>}
 * Removed tag text.
 */
function removeTag(
    doclet,
    tag
) {
    const tags = doclet.tags;

    if (tags) {
        const text = tags[tag];

        delete tags[tag];

        return text;
    }

    return [];
}


/**
 * Compiles doclet information into a code string.
 *
 * @see changeSourceCode
 *
 * @param {DocletInfo} doclet
 * Doclet information to compile.
 *
 * @param {number|string} indent
 * Indent styling.
 *
 * @return {string}
 * Doclet string.
 */
function toDocletString(
    doclet,
    indent = 0
) {

    if (typeof indent === 'number') {
        indent = '\n' + ''.padEnd(indent, ' ');
    }

    const tags = doclet.tags;

    let compiled = indent + '/**';

    if (
        tags.description &&
        tags.description.length === 1
    ) {
        compiled += (
            indent + ' * ' +
            tags.description[0]
                .trim()
                .split('\n')
                .join(indent + ' * ')
        );
        delete tags.description;
    }

    for (const tag of Object.keys(tags)) {
        for (const text of tags[tag]) {
            compiled += (
                indent + ' *' +
                indent + ' * @' + tag + ' ' +
                text
                    .trim()
                    .split('\n')
                    .join(indent + ' * ')
            );
        }
    }

    compiled = compiled
        .split('\n')
        .map(line => {
            line = line.trimEnd();
            if (line.length > 80) {
                const br = line.substring(0, 80).lastIndexOf(' ');
                return (
                    line.substring(0, br) +
                    indent + ' * ' + line.substring(br)
                );
            }
            return line;
        })
        .join('\n');

    return compiled + indent + ' */\n';
}


/**
 * Converts any tree to a JSON string, while converting TypeScript nodes to raw
 * code.
 *
 * @param {unknown} jsonTree
 * Tree to convert.
 *
 * @param {string} [indent]
 * Indent option.
 *
 * @return {string}
 * Converted JSON string.
 */
function toJSONString(
    jsonTree,
    indent
) {
    return JSON.stringify(
        jsonTree,
        (_key, value) => (
            (
                value &&
                typeof value === 'object' &&
                typeof value.kind === 'number' &&
                typeof value.getText === 'function'
            ) ?
                value.getText() :
                value
        ),
        indent
    );
}


/* *
 *
 *  Default Export
 *
 * */


module.exports = {
    addTag,
    changeSourceCode,
    changeSourceFile,
    debug,
    extractTypes,
    getChildInfos,
    getDocletInfosBetween,
    getNodesChildren,
    getNodesFirstChild,
    getNodesLastChild,
    getSourceInfo,
    getTagText,
    isCapitalCase,
    isNativeType,
    newDocletInfo,
    removeTag,
    toDocletString,
    toJSONString
};


/* *
 *
 *  Doclet Declarations
 *
 * */


/**
 * @typedef {'declare'|'export'|'private'|'protected'} InfoFlag
 */

/**
 * @typedef ClassInfo
 * @property {DocletInfo} [doclet]
 * @property {string} extends
 * @property {Array<InfoFlag>} [flags]
 * @property {Array<VariableInfo>} generics
 * @property {Array<string>} implements
 * @property {'Class'} kind
 * @property {string} name
 * @property {TS.ClassDeclaration} [node]
 * @property {Array<PropertyInfo>} properties
 */


/**
 * @typedef DeconstructInfo
 * @property {Record<string,string>} deconstructs
 * @property {DocletInfo} [doclet]
 * @property {Array<InfoFlag>} [flags]
 * @property {`Deconstruct`} kind
 * @property {string} [from]
 * @property {TS.VariableDeclaration} [node]
 * @property {string} [type]
 */


/**
 * @typedef DocletInfo
 * @property {'Doclet'} kind
 * @property {TS.JSDoc} [node]
 * @property {Record<string,Array<string>>} tags
 */


/**
 * @typedef FunctionInfo
 * @property {DocletInfo} [doclet]
 * @property {Array<InfoFlag>} [flags]
 * @property {Array<VariableInfo>} generics
 * @property {'Function'} kind
 * @property {string} name
 * @property {Array<VariableInfo>} [parameters]
 * @property {'?'} [suffix]
 * @property {string} [return]
 */


/**
 * @typedef ImportInfo
 * @property {DocletInfo} [doclet]
 * @property {Record<string,string>} imports
 * @property {'Import'} kind
 * @property {TS.ImportDeclaration} [node]
 * @property {string} from
 */


/**
 * @typedef InterfaceInfo
 * @property {DocletInfo} [doclet]
 * @property {Array<string>} extends
 * @property {Array<InfoFlag>} [flags]
 * @property {Array<VariableInfo>} generics
 * @property {'Interface'} kind
 * @property {TS.InterfaceDeclaration} [node]
 * @property {string} name
 * @property {Array<Propery>} properties
 */


/**
 * @typedef {DocletInfo|ImportInfo|InterfaceInfo|ObjectInfo|PropertyInfo|VariableInfo} NodeInfo
 */


/**
 * @typedef ObjectInfo
 * @property {'Object'} kind
 * @property {TS.Node} [node]
 * @property {Array<Propery>} properties
 * @property {string} [type]
 */


/**
 * @typedef PropertyInfo
 * @property {DocletInfo} [doclet]
 * @property {Array<InfoFlag>} [flags]
 * @property {'Property'} kind
 * @property {string} name
 * @property {TS.PropertyAssignment|TS.PropertyDeclaration|TS.PropertySignature} [node]
 * @property {string} [type]
 * @property {bigint|boolean|null|number|string|ObjectInfo} [value]
 */


/**
 * @typedef SourceInfo
 * @property {'Source'} kind
 * @property {TS.SourceFile} [node]
 * @property {string} path
 * @property {Array<NodeInfo>} code
 */


/**
 * @typedef VariableInfo
 * @property {DocletInfo} [doclet]
 * @property {Array<InfoFlag>} [flags]
 * @property {`Variable`} kind
 * @property {string} name
 * @property {TS.VariableDeclaration} [node]
 * @property {string} [type]
 * @property {bigint|boolean|null|number|string|ObjectInfo} [value]
 */


('');
