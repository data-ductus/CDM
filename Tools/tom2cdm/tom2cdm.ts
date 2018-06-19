import * as cdm from "../cdm-types/cdm-types"

export class tomModelToCdmCorpus {
    constructor() {

    }
    public addToCorpus(folderResult : cdm.ICdmFolderDef, model : any) {

        interface tomRelationship {
            name : string;
            fromTable : string;
            fromColumn : string;
            toTable : string;
            toColumn : string;
        }

        // add a master import for the folder
        let masterImport = "_allImports.cdm.json";
        let cdmDocImp : cdm.ICdmDocumentDef = folderResult.addDocument("_allImports.cdm.json", "");
        cdmDocImp.addImport("/foundations.cdm.json", "");

        // find the "tables" node. all the rest might be in different shapes depending on the input doc
        let findArray = (from : any, seek : string) : any[] => {
            if (typeof(from) == 'object') {
                for (let child in from) {
                    if (child == seek && typeof(from[child]) == 'object' && (from[child] instanceof Array))
                        return from[child];
                    let childResult = findArray(from[child], seek);
                    if (childResult)
                        return childResult;
                }
            }
        }

        let tables = findArray(model, "tables");
        let relationships = findArray(model, "relationships");
        let entAtt2Rel = new Map<string, tomRelationship[]>();
        let imports = new Set<string>();

        if (relationships) {
            // first collect all relationships in the model so that they can be added as attributes on the 'outgoing' entity
            relationships.forEach(rel => {
                let tomRel = rel as tomRelationship;

                let relKey = tomRel.fromTable + "_@_" + tomRel.fromColumn;
                if (!entAtt2Rel.has(relKey)) {
                    entAtt2Rel.set(relKey, new Array<tomRelationship>());
                }
                entAtt2Rel.get(relKey).push(tomRel);
                // import the entities that get referenced from other files
                if (!imports.has(tomRel.toTable)) {
                    imports.add(tomRel.toTable);
                    cdmDocImp.addImport(tomRel.toTable + ".cdm.json", "");
                }
                
            });
        }

        if (tables) {
            let table:any;
            tables.forEach(table => {
                // skip some goo
                if (!table.isHidden) {
                    let entName = table.name;
                    // one doc for each table
                    // imports
                    let cdmDocument = folderResult.addDocument(entName + ".cdm.json", "");
                    cdmDocument.addImport(masterImport, null);
                    // entity def
                    let cdmEntity  = cdmDocument.addDefinition<cdm.ICdmEntityDef>(cdm.cdmObjectType.entityDef, entName);
                    // the common base
                    cdmEntity.setExtendsEntityRef(cdm.Corpus.MakeRef(cdm.cdmObjectType.entityRef, "CdmObject"));

                    let getLocalizedTableTrait = (sourceText : string, traitName : string) : cdm.ICdmTraitRef => {
                        if (sourceText) {
                            let tRef = cdm.Corpus.MakeObject<cdm.ICdmTraitRef>(cdm.cdmObjectType.traitRef, traitName);
                            // make the argument nothing but a ref to a constant entity, safe since there is only one param for the trait and it looks cleaner
                            let cEnt = cdm.Corpus.MakeObject<cdm.ICdmConstantEntityDef>(cdm.cdmObjectType.constantEntityDef);
                            cEnt.setEntityShape(cdm.Corpus.MakeRef(cdm.cdmObjectType.entityRef, "localizedTable"));
                            cEnt.setConstantValues([["en", sourceText]]);
                            tRef.addArgument(undefined, cdm.Corpus.MakeRef(cdm.cdmObjectType.constantEntityRef, cEnt));
                            return tRef;
                        }
                            
                    }
            
                    // add descriptive  text
                    if (table.description)
                        cdmEntity.addExhibitedTrait(getLocalizedTableTrait(table.description, "is.localized.describedAs"));

                    // attributes
                    if (table.columns) {

                        // create an attribute group with a trait that lists the path.
                        let attGroupAll = cdm.Corpus.MakeObject<cdm.ICdmAttributeGroupDef>(cdm.cdmObjectType.attributeGroupDef, "attributesAddedAtThisScope");
                        let tRef = cdm.Corpus.MakeObject<cdm.ICdmTraitRef>(cdm.cdmObjectType.traitRef, "is.CDM.attributeGroup");
                        // make the argument nothing but a ref to a constant entity, safe since there is only one param for the trait and it looks cleaner
                        let cEnt = cdm.Corpus.MakeObject<cdm.ICdmConstantEntityDef>(cdm.cdmObjectType.constantEntityDef);
                        cEnt.setEntityShape(cdm.Corpus.MakeRef(cdm.cdmObjectType.entityRef, "attributeGroupSet"));
                        let groupPath = folderResult.getRelativePath() + cdmEntity.getName() + ".cdm.json/" + cdmEntity.getName() + "/hasAttributes/attributesAddedAtThisScope";
                        cEnt.setConstantValues([[groupPath]]);
                        tRef.addArgument(undefined, cdm.Corpus.MakeRef(cdm.cdmObjectType.constantEntityRef, cEnt));
                        attGroupAll.addExhibitedTrait(tRef);
                        cdmEntity.addAttributeDef(cdm.Corpus.MakeRef(cdm.cdmObjectType.attributeGroupRef, attGroupAll) as cdm.ICdmAttributeGroupRef);

                        let createTypeAttribute = (col : any) : cdm.ICdmTypeAttributeDef => {
                            let cdmAtt = cdm.Corpus.MakeObject<cdm.ICdmTypeAttributeDef>(cdm.cdmObjectType.typeAttributeDef, col.name);
                            let relRef : cdm.ICdmRelationshipRef = cdm.Corpus.MakeRef(cdm.cdmObjectType.relationshipRef, "hasA");
                            cdmAtt.setRelationshipRef(relRef);

                            // figure out a data type
                            let dataTypeName = "string";
                            if (col.dataType) {
                                if (col.dataType == "int64")
                                    dataTypeName = "bigInteger";
                                else
                                    dataTypeName = col.dataType;
                            }

                            let dataType = cdm.Corpus.MakeObject<cdm.ICdmDataTypeRef>(cdm.cdmObjectType.dataTypeRef, dataTypeName);
                            cdmAtt.setDataTypeRef(dataType);

                            cdmAtt.addAppliedTrait(getLocalizedTableTrait(col.description, "is.localized.describedAs"));
            
                            return cdmAtt;
                        }

                        table.columns.forEach(col => {

                            let attName = col.name;

                            // is this a foreign key?
                            let tomRels = entAtt2Rel.get(entName + "_@_" + attName);
                            if (tomRels) {

                                let makeRefEntity = (tomRel : tomRelationship) : cdm.ICdmEntityRef =>{
                                    let er : cdm.ICdmEntityRef = cdm.Corpus.MakeObject(cdm.cdmObjectType.entityRef, tomRel.toTable);
                                    let tRef = er.addAppliedTrait("is.identifiedBy");
                                    tRef.addArgument(undefined, cdm.Corpus.MakeObject(cdm.cdmObjectType.stringConstant, tomRel.toTable + "/(resolvedAttributes)/" +tomRel.toColumn));
                                    return er;
                                }  

                                let cdmAtt = cdm.Corpus.MakeObject<cdm.ICdmAttributeDef>(cdm.cdmObjectType.entityAttributeDef, null);
                                // make a list of all referenced entities
                                let entList = new Array<cdm.ICdmEntityRef>();
                                // entity relationship. to array or single?
                                if (tomRels.length > 1) {
                                    tomRels.forEach(tomRel => {
                                            entList.push(makeRefEntity(tomRel));
                                        });
                                    (cdmAtt as cdm.ICdmEntityAttributeDef).setEntityRef(entList);
                                }
                                else {
                                    entList.push(makeRefEntity(tomRels[0]));
                                    (cdmAtt as cdm.ICdmEntityAttributeDef).setEntityRef(entList[0]);
                                }

                                let rel = cdm.Corpus.MakeObject<cdm.ICdmRelationshipRef>(cdm.cdmObjectType.relationshipRef, "referencesA")
                                let tRef = rel.addAppliedTrait("referencesA/exhibitsTraits/does.referenceEntity");
                                tRef.addArgument("addedAttribute", createTypeAttribute(col));
                                cdmAtt.setRelationshipRef(rel);
                                attGroupAll.addMemberAttributeDef(cdmAtt);

                            }
                            else {
                                attGroupAll.addMemberAttributeDef(createTypeAttribute(col));
                            }
                        });
                    }
                }
            });
        }
    }
}
