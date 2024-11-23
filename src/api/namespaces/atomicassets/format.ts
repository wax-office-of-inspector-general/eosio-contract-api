export function formatAsset(row: any): any {
    const data = {...row};

    data.collection = formatCollection(data.collection);
    data.schema = formatSchema(data.schema);

    data.mutable_data = Object.assign({}, data.mutable_data);
    data.immutable_data = Object.assign({}, data.immutable_data);

    data['data'] = {
        ...data.mutable_data,
        ...data.immutable_data
    };

    if (data.template) {
        data.template.immutable_data = Object.assign({}, data.template.immutable_data);
        data.template.mutable_data = Object.assign({}, data.template.mutable_data);
        data.template.data = {...data.template.mutable_data, ...data.template.immutable_data};

        data['data'] = {
            ...data.template.mutable_data,
            ...data.mutable_data,
            ...data.immutable_data,
            ...data.template.immutable_data,
        };
    }

    data.name = data.data.name;

    delete data['template_id'];
    delete data['schema_name'];
    delete data['collection_name'];
    delete data['authorized_accounts'];

    return data;
}

export function formatTemplate(row: any): any {
    const data = {...row};

    data.collection = formatCollection(data.collection);
    data.schema = formatSchema(data.schema);

    data.immutable_data = data.immutable_data || {};
    data.mutable_data = data.mutable_data || {};
    data.data = {...data.mutable_data, ...data.immutable_data};
    data.name = data.data.name;

    delete data['schema_name'];
    delete data['collection_name'];
    delete data['authorized_accounts'];

    return data;
}

export function formatSchema(row: any): any {
    const {collection_name, authorized_accounts, ...data} = row;

    data.collection = formatCollection(data.collection);
    data.format = data.format.map((row: {name: string, type: string}) => {
        const type = data.types.find((x: {name: string, mediatype: string, info: string}) => x.name === row.name);

        const checkName = (match: string): boolean =>
            row.name.toLowerCase().startsWith(match) || row.name.toLowerCase().endsWith(match);

        let adjustedType = null;

        if (row.name === 'name') {
            adjustedType = 'name';
        }

        if (checkName('image') || checkName('img') || row.type === 'image') {
            adjustedType = 'image';
        }

        if (checkName('video')) {
            adjustedType = 'video';
        }

        if (checkName('audio')) {
            adjustedType = 'audio';
        }

        return {
           ...row,
           mediatype: type?.mediatype || adjustedType,
           info: type?.info || null,
        };
    });

    delete data['types'];

    return data;
}

export function formatCollection(row: any): any {
    return row;
}

export function formatOffer(row: any): any {
    const data = {...row};

    delete data['recipient_contract_account'];

    return data;
}

export function formatTransfer(row: any): any {
    return {...row};
}

export function formatMove(row: any): any {
    return {...row};
}
